// The Space field: chunks as points on black, in 2D or an orbitable 3D, in one or two panes.
//
// Plain canvas 2D, no 3D library: a few thousand points, one camera (yaw, pitch, zoom, pan) shared by
// both panes, and a perspective blend that animates between flat and 3D. Positions are keyed by chunk
// id, so whenever they change (projection method, 2D/3D, or another version's space) the points move
// to their new place over the timeline's sweep (2.4s) instead of jumping.
//
// Depth in 3D comes from cues, because a dot has no shading: far points fade into the black and shrink,
// every point casts a faint shadow on a floor grid, the points that matter get a drop line to the floor,
// and the view turns slowly while nobody touches it (motion is the strongest depth cue).

import { useEffect, useRef, useState } from "react";

export interface PanePoint { id: number; x: number; y: number; z: number }   // normalised to [-1, 1]
export interface PaneQuery { id: number; label: string; x: number; y: number; z: number }
export interface PaneHit { id: number; rank: number; relevant: boolean }

export interface Pane {
  key: string;                  // stays the same while points should move rather than reappear
  label?: string;
  points: PanePoint[];          // keep the same array while positions don't change (it starts a morph)
  colors: string[];             // one per point
  visible: boolean[] | null;    // filters; null = all
  emphasis: Set<number> | null; // when set, every other point is dimmed
  queries: PaneQuery[];         // every question, as small hollow diamonds
  focus: PaneQuery | null;      // the picked question
  hits: PaneHit[];              // its ranked list for the chosen step
  missed: number[];             // relevant chunks that list doesn't have
  selected: number | null;
  neighbours: number[];         // the selected chunk's true nearest neighbours
  linked: Set<number> | null;   // what the pointer is on in the other pane
}

export type Target = { pane: number; kind: "chunk" | "query"; id: number; clientX: number; clientY: number };
export type ViewCommand = { n: number; type: "in" | "out" | "reset" };

interface Camera { yaw: number; pitch: number; persp: number; zoom: number; panX: number; panY: number }
const FLAT: Camera = { yaw: 0, pitch: 0, persp: 0, zoom: 1, panX: 0, panY: 0 };
// The map lies on the floor (x, y) and the third coordinate is height (z). 2D looks straight down;
// 3D tilts the floor back (pitch) and turns it around the vertical axis (yaw).
const ORBIT = { yaw: 0.45, pitch: 1.0, persp: 1 };
const DEPTH = 5;                // camera distance for the perspective, in normalised units
const FLOOR = -1.15;            // height of the floor grid, just under the lowest points
const IDLE_MS = 2500;           // turn slowly after this long without interaction
const SPIN = 0.12;              // radians per second
const FONT = "600 11px 'Mona Sans Variable', ui-sans-serif, system-ui, sans-serif";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Centre the points on the origin and scale them into [-1, 1], keeping proportions. */
export function normalise<T extends { x: number; y: number; z: number | null }>(rows: T[], three: boolean): { x: number; y: number; z: number }[] {
  if (!rows.length) return [];
  const mean = (k: "x" | "y" | "z") => rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length;
  const mx = mean("x"), my = mean("y"), mz = three ? mean("z") : 0;
  let m = 1e-9;
  for (const r of rows) m = Math.max(m, Math.abs(r.x - mx), Math.abs(r.y - my), three ? Math.abs((r.z ?? 0) - mz) : 0);
  return rows.map((r) => ({ x: (r.x - mx) / m, y: (r.y - my) / m, z: three ? ((r.z ?? 0) - mz) / m : 0 }));
}

interface Motion {
  points: PanePoint[];
  from: Map<number, [number, number, number]>;
  t0: number;
  dur: number;
  pos: Float32Array;            // displayed x, y, z per point (this frame)
  sx: Float32Array;             // screen position per point (this frame)
  sy: Float32Array;
  depth: Float32Array;
  order: number[];              // draw order, far to near
  index: Map<number, number>;   // chunk id -> point index
  qx: number[];
  qy: number[];
}

export function SpaceCanvas({ panes, three, insets, command, onHover, onSelect, onPickQuery, label }: {
  panes: Pane[];
  three: boolean;
  insets: { l: number; r: number; t: number; b: number };
  command: ViewCommand;
  onHover: (t: Target | null) => void;
  onSelect: (pane: number, id: number | null) => void;
  onPickQuery: (id: number) => void;
  label: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const cam = useRef<Camera>({ ...FLAT });
  const goal = useRef<Camera>({ ...FLAT });
  const motions = useRef(new Map<string, Motion>());
  const frame = useRef(0);
  const hoverRef = useRef<Target | null>(null);
  const lastTouch = useRef(performance.now());
  const lastFrame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const props = useRef({ panes, three, insets, size });
  props.current = { panes, three, insets, size };
  const box = useRef({ ...insets });   // eases towards `insets`, so opening a sheet slides the field over

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // positions changed: start a morph from wherever each point is shown now
  for (const pane of panes) {
    const m = motions.current.get(pane.key);
    if (m && m.points === pane.points) continue;
    const from = new Map<number, [number, number, number]>();
    if (m) m.points.forEach((p, i) => from.set(p.id, [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]));
    const overlap = pane.points.some((p) => from.has(p.id));
    const n = pane.points.length;
    motions.current.set(pane.key, {
      points: pane.points, from, t0: performance.now(), dur: overlap && !reducedMotion() ? 2400 : 0,
      pos: new Float32Array(n * 3), sx: new Float32Array(n), sy: new Float32Array(n), depth: new Float32Array(n),
      order: pane.points.map((_, i) => i), index: new Map(pane.points.map((p, i) => [p.id, i])), qx: [], qy: [],
    });
  }

  // 2D <-> 3D: the camera tilts and the perspective fades in (or out)
  useEffect(() => {
    goal.current = three ? { ...goal.current, ...ORBIT } : { ...goal.current, yaw: 0, pitch: 0, persp: 0 };
    if (reducedMotion()) cam.current = { ...goal.current };
    drawRef.current();
  }, [three]);

  useEffect(() => {
    if (command.n === 0) return;
    const g = goal.current;
    if (command.type === "reset") goal.current = { ...(three ? { ...FLAT, ...ORBIT } : FLAT) };
    else goal.current = { ...g, zoom: Math.min(30, Math.max(0.4, g.zoom * (command.type === "in" ? 1.4 : 1 / 1.4))) };
    if (reducedMotion()) cam.current = { ...goal.current };
    drawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.n]);

  /** The screen box of each pane: side by side when wide, stacked when narrow. */
  const boxes = () => {
    const { size: s, panes: ps } = props.current;
    const i = box.current;
    const w = s.w - i.l - i.r, h = s.h - i.t - i.b;
    if (ps.length < 2) return [{ x: i.l, y: i.t, w, h }];
    const gap = 32;
    return w >= h
      ? [{ x: i.l, y: i.t, w: (w - gap) / 2, h }, { x: i.l + (w + gap) / 2, y: i.t, w: (w - gap) / 2, h }]
      : [{ x: i.l, y: i.t, w, h: (h - gap) / 2 }, { x: i.l, y: i.t + (h + gap) / 2, w, h: (h - gap) / 2 }];
  };

  drawRef.current = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  };

  function draw(now: number) {
    const canvas = canvasRef.current;
    const { panes: ps, size: s } = props.current;
    if (!canvas || !s.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(s.w * dpr)) canvas.width = Math.round(s.w * dpr);
    if (canvas.height !== Math.round(s.h * dpr)) canvas.height = Math.round(s.h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);

    // camera and field box ease towards their goals
    const c = cam.current, g = goal.current;
    let moving = false;
    const want = props.current.insets;
    for (const k of ["l", "r", "t", "b"] as const) {
      const d = want[k] - box.current[k];
      if (Math.abs(d) > 0.5 && !reducedMotion()) { box.current[k] += d * 0.16; moving = true; } else box.current[k] = want[k];
    }
    for (const k of ["yaw", "pitch", "persp", "zoom", "panX", "panY"] as const) {
      const d = g[k] - c[k];
      if (Math.abs(d) > (k === "panX" || k === "panY" ? 0.2 : 1e-3)) { c[k] += d * 0.16; moving = true; } else c[k] = g[k];
    }
    // 3D: turn slowly once the pointer has been still for a while, unless it rests on a point
    const dt = Math.min(0.1, (now - (lastFrame.current || now)) / 1000);
    lastFrame.current = now;
    if (props.current.three && !reducedMotion() && !hoverRef.current && !drag.current) {
      if (now - lastTouch.current > IDLE_MS) { g.yaw += SPIN * dt; c.yaw += SPIN * dt; }
      moving = true;
    }

    const hair = cssVar("--hair"), ink = cssVar("--ink"), ink2 = cssVar("--ink-2"), ink3 = cssVar("--ink-3");
    const sweep = cssVar("--sweep-hi"), lost = cssVar("--lost");
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const hov = hoverRef.current;

    boxes().forEach((box, pi) => {
      const pane = ps[pi];
      const m = pane && motions.current.get(pane.key);
      if (!pane || !m) return;
      // in 3D the floor hangs under the cloud: shrink a little and lift, so cloud and floor sit centred
      const scale = (Math.min(box.w, box.h) / 2) * 0.94 * c.zoom * (1 - 0.2 * c.persp);
      const ox = box.x + box.w / 2 + c.panX;
      const oy = box.y + box.h / 2 + c.panY + (FLOOR / 2) * Math.sin(c.pitch) * scale * c.persp;
      // turn the floor around the vertical axis, then tilt it away; depth > 0 is towards the viewer
      const project = (x: number, y: number, z: number): [number, number, number] => {
        const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
        const up = y1 * cp + z * sp, depth = z * cp - y1 * sp;
        const f = 1 + (DEPTH / (DEPTH - Math.min(depth, DEPTH - 0.5)) - 1) * c.persp;
        return [ox + x1 * scale * f, oy - up * scale * f, depth];
      };

      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x - 40, box.y - 40, box.w + 80, box.h + 80);
      if (ps.length > 1) ctx.clip();

      // 3D: a floor grid under the points, fading in with the perspective
      if (c.persp > 0.01) {
        ctx.globalAlpha = c.persp;
        ctx.strokeStyle = hair;
        ctx.lineWidth = 1;
        for (let v = -1; v <= 1.001; v += 0.25) {
          const edge = Math.abs(v) > 0.99;
          ctx.strokeStyle = edge ? cssVar("--hair-2") : hair;
          for (const [a, b] of [[[v, -1], [v, 1]], [[-1, v], [1, v]]] as const) {
            const [x1, y1] = project(a[0], a[1], FLOOR);
            const [x2, y2] = project(b[0], b[1], FLOOR);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      // positions this frame
      const t = m.dur ? Math.min(1, (now - m.t0) / m.dur) : 1;
      if (t < 1) moving = true;
      const k = ease(t);
      m.points.forEach((p, i) => {
        const f = m.from.get(p.id);
        const x = f ? f[0] + (p.x - f[0]) * k : p.x, y = f ? f[1] + (p.y - f[1]) * k : p.y, z = f ? f[2] + (p.z - f[2]) * k : p.z;
        m.pos[i * 3] = x; m.pos[i * 3 + 1] = y; m.pos[i * 3 + 2] = z;
        const [px, py, pz] = project(x, y, z);
        m.sx[i] = px; m.sy[i] = py; m.depth[i] = pz;
      });
      if (c.persp > 0.01) m.order.sort((a, b) => m.depth[a] - m.depth[b]);

      // 3D: every point's shadow on the floor
      if (c.persp > 0.01) {
        ctx.fillStyle = ink;
        for (const i of m.order) {
          if (pane.visible && !pane.visible[i]) continue;
          const [fx, fy] = project(m.pos[i * 3], m.pos[i * 3 + 1], FLOOR);
          ctx.globalAlpha = 0.09 * c.persp;
          ctx.fillRect(fx - 1, fy - 0.5, 2, 1);
        }
        ctx.globalAlpha = 1;
      }
      // a dashed line from a point down to the floor, for the points that matter
      const drop = (x: number, y: number, z: number) => {
        if (c.persp < 0.01) return;
        const [px, py] = project(x, y, z);
        const [fx, fy] = project(x, y, FLOOR);
        ctx.save();
        ctx.globalAlpha = 0.6 * c.persp;
        ctx.strokeStyle = ink3;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(fx, fy);
        ctx.stroke();
        ctx.restore();
      };
      const dropId = (id: number | null | undefined) => {
        const i = id != null ? m.index.get(id) : undefined;
        if (i != null) drop(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
      };
      for (const h of pane.hits) dropId(h.id);
      dropId(pane.selected);
      if (hov?.pane === pi && hov.kind === "chunk") dropId(hov.id);
      if (pane.focus) drop(pane.focus.x, pane.focus.y, pane.focus.z);

      // the points: filtered ones are not drawn; new ones fade in during a morph
      const dimmed = pane.emphasis;
      for (const i of m.order) {
        if (pane.visible && !pane.visible[i]) continue;
        const p = m.points[i];
        // 0 = farthest, 1 = nearest; far points fade towards the black and shrink (fog)
        const near = Math.max(0, Math.min(1, (m.depth[i] + 1.1) / 2.2));
        const fog = 1 - c.persp * (1 - (0.3 + 0.7 * near));
        const fresh = m.from.size && !m.from.has(p.id) ? k : 1;
        ctx.globalAlpha = (dimmed && !dimmed.has(p.id) ? 0.14 : 0.9) * fog * fresh;
        ctx.fillStyle = pane.colors[i] ?? ink2;
        ctx.beginPath();
        ctx.arc(m.sx[i], m.sy[i], 2.5 * (1 + c.persp * (near * 1.1 - 0.45)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const at = (id: number) => m.index.get(id);

      // the other pane's pointer: same chunk (or its document's chunks) ringed in ink
      if (pane.linked) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        for (const id of pane.linked) {
          const i = at(id);
          if (i == null) continue;
          ctx.beginPath();
          ctx.arc(m.sx[i], m.sy[i], 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // true neighbours of the selected chunk: thin lines and rings
      const sel = pane.selected != null ? at(pane.selected) : undefined;
      if (sel != null) {
        ctx.strokeStyle = ink2;
        ctx.globalAlpha = 0.55;
        for (const id of pane.neighbours) {
          const i = at(id);
          if (i == null) continue;
          ctx.beginPath();
          ctx.moveTo(m.sx[sel], m.sy[sel]);
          ctx.lineTo(m.sx[i], m.sy[i]);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (const id of pane.neighbours) {
          const i = at(id);
          if (i == null) continue;
          ctx.beginPath();
          ctx.arc(m.sx[i], m.sy[i], 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // every question, as small hollow diamonds
      m.qx = []; m.qy = [];
      ctx.strokeStyle = ink3;
      ctx.lineWidth = 1;
      for (const q of pane.queries) {
        const [qx, qy] = project(q.x, q.y, q.z);
        m.qx.push(qx); m.qy.push(qy);
        diamond(ctx, qx, qy, 3.5);
        ctx.stroke();
      }

      // the picked question: missed relevant chunks, its ranked list, and where it lands
      const focus = pane.focus ? project(pane.focus.x, pane.focus.y, pane.focus.z) : null;
      ctx.strokeStyle = lost;
      ctx.lineWidth = 1.5;
      for (const id of pane.missed) {
        const i = at(id);
        if (i == null) continue;
        ctx.beginPath();
        ctx.arc(m.sx[i], m.sy[i], 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (focus) {
        ctx.strokeStyle = "rgba(77, 148, 255, 0.45)";
        ctx.lineWidth = 1;
        for (const h of pane.hits) {
          const i = at(h.id);
          if (i == null) continue;
          ctx.beginPath();
          ctx.moveTo(focus[0], focus[1]);
          ctx.lineTo(m.sx[i], m.sy[i]);
          ctx.stroke();
        }
      }
      ctx.font = FONT;
      for (const h of pane.hits) {
        const i = at(h.id);
        if (i == null) continue;
        const x = m.sx[i], y = m.sy[i];
        ctx.fillStyle = sweep;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (h.relevant) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        tag(ctx, String(h.rank), x + 8, y - 17, ink);
      }
      if (focus && pane.focus) {
        ctx.fillStyle = ink;
        diamond(ctx, focus[0], focus[1], 6);
        ctx.fill();
        tag(ctx, pane.focus.label, focus[0] + 10, focus[1] + 4, ink);
      }

      // the selected chunk: a blue wash with an ink ring
      if (sel != null) {
        ctx.fillStyle = cssVar("--sweep-wash");
        ctx.beginPath();
        ctx.arc(m.sx[sel], m.sy[sel], 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(m.sx[sel], m.sy[sel], 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // what the pointer is on
      if (hov && hov.pane === pi) {
        const p = hov.kind === "chunk" ? at(hov.id) : undefined;
        const qi = hov.kind === "query" ? pane.queries.findIndex((q) => q.id === hov.id) : -1;
        const x = p != null ? m.sx[p] : m.qx[qi], y = p != null ? m.sy[p] : m.qy[qi];
        if (x != null && y != null) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (pane.label) {
        ctx.font = FONT;
        ctx.fillStyle = ink3;
        ctx.fillText(pane.label.toUpperCase(), box.x, box.y - 14);
      }
      ctx.restore();
    });

    if (moving) frame.current = requestAnimationFrame(draw);
  }

  // redraw whenever anything shown changes
  useEffect(() => { drawRef.current(); });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // ---------- pointer ----------

  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean } | null>(null);

  const find = (mx: number, my: number): Omit<Target, "clientX" | "clientY"> | null => {
    const { panes: ps } = props.current;
    let best: Omit<Target, "clientX" | "clientY"> | null = null;
    let bestD = 64;   // 8px radius, squared
    ps.forEach((pane, pi) => {
      const m = motions.current.get(pane.key);
      if (!m) return;
      pane.queries.forEach((q, qi) => {
        const d = (m.qx[qi] - mx) ** 2 + (m.qy[qi] - my) ** 2;
        if (d < bestD) { bestD = d; best = { pane: pi, kind: "query", id: q.id }; }
      });
      for (let i = 0; i < m.points.length; i++) {
        if (pane.visible && !pane.visible[i]) continue;
        const d = (m.sx[i] - mx) ** 2 + (m.sy[i] - my) ** 2;
        if (d < bestD) { bestD = d; best = { pane: pi, kind: "chunk", id: m.points[i].id }; }
      }
    });
    return best;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    lastTouch.current = performance.now();
    drag.current = { x: e.clientX, y: e.clientY, moved: false, pan: !three || e.shiftKey || e.button === 2 };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    lastTouch.current = performance.now();
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      d.x = e.clientX; d.y = e.clientY;
      const g = goal.current, c = cam.current;
      if (d.pan) { g.panX += dx; g.panY += dy; c.panX = g.panX; c.panY = g.panY; }
      else {
        g.yaw += dx * 0.008;
        g.pitch = Math.max(0, Math.min(1.45, g.pitch + dy * 0.008));   // from straight down to the side, never under the floor
        c.yaw = g.yaw; c.pitch = g.pitch;
      }
      hoverRef.current = null;
      onHover(null);
      drawRef.current();
      return;
    }
    const [mx, my] = local(e);
    const hit = find(mx, my);
    const next = hit ? { ...hit, clientX: e.clientX, clientY: e.clientY } : null;
    const prev = hoverRef.current;
    hoverRef.current = next;
    if (prev?.id !== next?.id || prev?.kind !== next?.kind || prev?.pane !== next?.pane || next) onHover(next);
    if (prev?.id !== next?.id || prev?.kind !== next?.kind) drawRef.current();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) return;
    const [mx, my] = local(e);
    const hit = find(mx, my);
    if (hit?.kind === "query") onPickQuery(hit.id);
    else onSelect(hit?.pane ?? 0, hit?.id ?? null);
  };

  // wheel zooms around the pointer (a non-passive listener, so the page doesn't scroll)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastTouch.current = performance.now();
      const g = goal.current, c = cam.current;
      const z = Math.min(30, Math.max(0.4, g.zoom * Math.exp(-e.deltaY * 0.0015)));
      const [mx, my] = local(e);
      const box = boxes().find((b) => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) ?? boxes()[0];
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      g.panX = mx - cx - (mx - cx - g.panX) * (z / g.zoom);
      g.panY = my - cy - (my - cy - g.panY) * (z / g.zoom);
      g.zoom = z;
      Object.assign(c, { zoom: g.zoom, panX: g.panX, panY: g.panY });
      drawRef.current();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="space-wrap">
      <canvas ref={canvasRef} className={`space-canvas ${three ? "orbit" : ""}`} style={{ width: size.w, height: size.h }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              onPointerLeave={() => {
                if (!drag.current) { hoverRef.current = null; onHover(null); }
                drawRef.current();
              }}
              onContextMenu={(e) => e.preventDefault()}
              role="img" aria-label={label} />
    </div>
  );
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

/** A small numeral or id on a black label, the scene's only kind of text. */
function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string) {
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 16, 4);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.fillText(text, x + 4, y + 12);
}
