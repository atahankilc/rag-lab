// The Space field: chunks as points of light, in 2D or an orbitable 3D, in one or two panes.
//
// Two layers. three.js (WebGL) draws what is many: every chunk as a crisp dot in its own colour, and a
// flowing dot sphere around every coloured group. A plain 2D canvas on top draws what must stay sharp and
// readable: the questions' diamonds, the ranked hits with their numbers, the lines to them, rings for missed
// chunks, the selection and the hover ring. Nothing fades with distance: in 3D every point stays clear.
//
// When the map first appears, its chunks rise out of the dot pool below (components/DotPool.tsx) and gather
// into their places, so the sea of dots becomes the knowledge space.
//
// One perspective camera (yaw, pitch, zoom, pan) is shared by both panes. 2D is that camera looking straight
// down through a narrow lens, 3D is the same camera tilted back with a wide one, so switching between them is
// one smooth move. Positions are keyed by chunk id: whenever they change (projection method, 2D/3D, another
// version's space), the points travel to their new place over the timeline's sweep (2.4s) instead of jumping.
// Picking a question flies the camera to it.
//
// Data coordinates are (x, y) on the floor and z as height; in three.js that is (x, z, -y).

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { motionOff } from "../state/motion";

export interface PanePoint {
  id: number;
  x: number;
  y: number;
  z: number;
} // normalised to [-1, 1]
export interface PaneQuery {
  id: number;
  label: string;
  x: number;
  y: number;
  z: number;
}
export interface PaneHit {
  id: number;
  rank: number;
  relevant: boolean;
}

export interface Pane {
  key: string; // stays the same while points should move rather than reappear
  label?: string;
  points: PanePoint[]; // keep the same array while positions don't change (it starts a morph)
  colors: string[]; // one per point
  visible: boolean[] | null; // filters; null = all
  emphasis: Set<number> | null; // when set, every other point is dimmed
  queries: PaneQuery[]; // every question, as small hollow diamonds
  focus: PaneQuery | null; // the picked question
  hits: PaneHit[]; // its ranked list for the chosen step
  missed: number[]; // relevant chunks that list doesn't have
  selected: number | null;
  neighbours: number[]; // the selected chunk's true nearest neighbours
  linked: Set<number> | null; // what the pointer is on in the other pane
}

export type Target = { pane: number; kind: "chunk" | "query"; id: number; clientX: number; clientY: number };
export type ViewCommand = { n: number; type: "in" | "out" | "reset" };

interface Camera {
  yaw: number;
  pitch: number; // 0 = straight down, up to 1.45 = from the side
  persp: number; // 0 = 2D (narrow lens), 1 = 3D (wide lens)
  zoom: number;
  panX: number; // the point the camera looks at, on the floor, in world units
  panZ: number;
}
// The shaders write colours as they are given (the palette's sRGB values), so three.js must not convert them.
THREE.ColorManagement.enabled = false;

const FLAT: Camera = { yaw: 0, pitch: 0, persp: 0, zoom: 1, panX: 0, panZ: 0 };
const ORBIT = { yaw: 0.45, pitch: 1.0, persp: 1 };
const FLOOR = -1.15; // the height the chunks rise from, under the lowest points
const SHOW_DROPS = false; // dashed lines to a floor: off, since there is no floor drawn any more
const IDLE_MS = 2500; // turn slowly after this long without interaction
const SPIN = 0.12; // radians per second
const FONT = "600 11px 'Mona Sans Variable', ui-sans-serif, system-ui, sans-serif";
const SHELL_MAX_GROUPS = 14; // more colours than this read as noise, not clusters: no shells then
const SHELL_MIN_POINTS = 12;

// Unit vectors spread evenly over a sphere (Fibonacci lattice): the dots of every shell.
const SPHERE: [number, number, number][] = (() => {
  const n = 900,
    out: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2,
      r = Math.sqrt(1 - y * y),
      a = golden * i;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
})();

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const reducedMotion = motionOff;
const isLight = () => document.documentElement.dataset.theme === "light";
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Centre the points on the origin and scale them into [-1, 1], keeping proportions. */
export function normalise<T extends { x: number; y: number; z: number | null }>(
  rows: T[],
  three: boolean,
): { x: number; y: number; z: number }[] {
  if (!rows.length) return [];
  const mean = (k: "x" | "y" | "z") => rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length;
  const mx = mean("x"),
    my = mean("y"),
    mz = three ? mean("z") : 0;
  let m = 1e-9;
  for (const r of rows) m = Math.max(m, Math.abs(r.x - mx), Math.abs(r.y - my), three ? Math.abs((r.z ?? 0) - mz) : 0);
  return rows.map((r) => ({ x: (r.x - mx) / m, y: (r.y - my) / m, z: three ? ((r.z ?? 0) - mz) / m : 0 }));
}

// ---------- shaders ----------

const pointVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform float uPixel;
  uniform float uPersp;
  uniform float uRefDist;
  uniform float uSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    // in 3D, near points are a little bigger and far ones a little smaller; nothing fades
    float att = mix(1.0, clamp(uRefDist / d, 0.75, 1.5), uPersp);
    gl_PointSize = uSize * uPixel * att;
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;
const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0 || vAlpha <= 0.0) discard;
    // a crisp dot with a one-pixel soft edge
    float a = 1.0 - smoothstep(0.7, 1.0, r);
    gl_FragColor = vec4(vColor, vAlpha * a);
  }
`;
const shellVertex = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uR;
  uniform float uTime;
  uniform float uSeed;
  uniform float uPixel;
  uniform float uPersp;
  uniform float uRefDist;
  uniform float uFade;
  uniform float uBase;
  varying float vAlpha;
  void main() {
    vec3 u = position;
    float rot = uTime * 0.07 + uSeed;
    float c = cos(rot), s = sin(rot);
    // turn around a tilted axis, and breathe
    vec3 r1 = vec3(u.x * c + u.z * s, u.y, -u.x * s + u.z * c);
    r1 = vec3(r1.x, r1.y * 0.94 + r1.z * 0.34, -r1.y * 0.34 + r1.z * 0.94);
    float w = 1.0 + 0.07 * sin(u.x * 4.0 + uTime * 0.8 + uSeed) * cos(u.y * 3.0 - uTime * 0.55);
    vec3 p = uCenter + r1 * uR * w;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // the side facing the viewer is brighter: that is what makes a cloud of dots read as a sphere
    float facing = dot(normalize(r1), normalize(cameraPosition - p));
    vAlpha = (uBase + 0.36 * (0.5 + 0.5 * facing)) * uFade;
    gl_PointSize = 1.7 * uPixel * mix(1.0, clamp(uRefDist / -mv.z, 0.5, 2.0), uPersp);
  }
`;
const shellFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
  }
`;

// ---------- per-pane GPU state ----------

interface Shell {
  color: string;
  idx: number[];
  r: number; // radius in normalised units, from the points' final positions
  seed: number;
  obj: THREE.Points;
  mat: THREE.ShaderMaterial;
}

interface PaneGL {
  points: PanePoint[];
  from: Map<number, [number, number, number]>;
  t0: number;
  dur: number;
  pos: Float32Array; // displayed data x, y, z per point (this frame)
  index: Map<number, number>; // chunk id -> point index
  scene: THREE.Scene;
  geo: THREE.BufferGeometry;
  cloud: THREE.Points;
  floor: THREE.LineSegments;
  shells: Shell[];
  look: { colors: string[] | null; visible: boolean[] | null; emphasis: Set<number> | null; light: boolean };
  cam: THREE.PerspectiveCamera;
  box: { x: number; y: number; w: number; h: number };
  qx: number[];
  qy: number[];
  focusId: number | null;
  intro: boolean; // the first appearance: the chunks rise out of the sea
}

/** A stable number in [0, 1) per chunk id. */
const hash01 = (id: number) => {
  const s = Math.sin(id * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function SpaceCanvas({
  panes,
  three,
  insets,
  command,
  onHover,
  onSelect,
  onPickQuery,
  label,
}: {
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
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const pointMat = useRef<THREE.ShaderMaterial | null>(null);
  const cam = useRef<Camera>({ ...FLAT });
  const goal = useRef<Camera>({ ...FLAT });
  const gls = useRef(new Map<string, PaneGL>());
  const frame = useRef(0);
  const hoverRef = useRef<Target | null>(null);
  const lastTouch = useRef(performance.now());
  const lastFrame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const props = useRef({ panes, three, insets, size });
  props.current = { panes, three, insets, size };
  const box = useRef({ ...insets }); // eases towards `insets`, so opening a sheet slides the field over

  // ---------- setup ----------

  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    try {
      renderer.current = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      renderer.current = null; // no WebGL: only the overlay marks are drawn
    }
    renderer.current?.setClearColor(0x000000, 0);
    pointMat.current = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      uniforms: {
        uPixel: { value: 1 },
        uPersp: { value: 0 },
        uRefDist: { value: 1 },
        uSize: { value: 6 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    for (const g of gls.current.values()) g.cloud.material = pointMat.current;
    const theme = new MutationObserver(() => {
      for (const g of gls.current.values()) g.look = { ...g.look, light: !isLight() }; // forces a colour refresh
      drawRef.current();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const panesNow = gls.current;
    drawRef.current(); // a remount (React mounts twice in development) rebuilds the panes on the next frame
    return () => {
      theme.disconnect();
      cancelAnimationFrame(frame.current);
      for (const g of panesNow.values()) disposePane(g);
      panesNow.clear();
      pointMat.current?.dispose();
      renderer.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const r = renderer.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (r && size.w) {
      r.setPixelRatio(dpr);
      r.setSize(size.w, size.h, false);
    }
    const o = overlayRef.current;
    if (o && size.w) {
      o.width = Math.round(size.w * dpr);
      o.height = Math.round(size.h * dpr);
    }
    if (pointMat.current) pointMat.current.uniforms.uPixel.value = dpr;
    drawRef.current();
  }, [size]);

  // positions changed: start a morph from wherever each point is shown now. Runs on every render and at the
  // start of every frame, so panes thrown away by a remount are rebuilt too.
  const sync = (list: Pane[]) => {
    for (const pane of list) {
      const g = gls.current.get(pane.key);
      if (g && g.points === pane.points) continue;
      const from = new Map<number, [number, number, number]>();
      if (g) g.points.forEach((p, i) => from.set(p.id, [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]]));
      const overlap = pane.points.some((p) => from.has(p.id));
      const keep = g ? { cam: g.cam, box: g.box, focusId: g.focusId } : null;
      if (g) disposePane(g);
      // nothing shown before: the chunks start in the sea below and rise into place
      const intro = !overlap && !reducedMotion() && pane.points.length > 0;
      if (intro)
        for (const p of pane.points) {
          const a = hash01(p.id) * Math.PI * 2,
            rr = 0.6 + hash01(p.id + 7) * 2.4;
          from.set(p.id, [Math.cos(a) * rr * 1.4, Math.sin(a) * rr, FLOOR * 2.2 - hash01(p.id + 3) * 0.6]);
        }
      const dur = overlap && !reducedMotion() ? 2400 : intro ? 3200 : 0;
      const next = makePane(pane.points, from, dur, pointMat.current);
      next.intro = intro;
      if (keep) Object.assign(next, keep);
      gls.current.set(pane.key, next);
    }
    for (const key of [...gls.current.keys()]) {
      if (!list.some((p) => p.key === key)) {
        disposePane(gls.current.get(key)!);
        gls.current.delete(key);
      }
    }
  };
  sync(panes);

  // 2D <-> 3D: the camera tilts and the lens widens (or back)
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
    const w = s.w - i.l - i.r,
      h = s.h - i.t - i.b;
    if (ps.length < 2) return [{ x: i.l, y: i.t, w, h }];
    const gap = 32;
    return w >= h
      ? [
          { x: i.l, y: i.t, w: (w - gap) / 2, h },
          { x: i.l + (w + gap) / 2, y: i.t, w: (w - gap) / 2, h },
        ]
      : [
          { x: i.l, y: i.t, w, h: (h - gap) / 2 },
          { x: i.l, y: i.t + (h + gap) / 2, w, h: (h - gap) / 2 },
        ];
  };

  /** Point the pane's camera for this camera state and box; returns its distance to the target. */
  const aim = (g: PaneGL, c: Camera, b: { w: number; h: number }) => {
    const fov = mix(9, 42, c.persp);
    const half = Math.tan(((fov / 2) * Math.PI) / 180);
    const aspect = Math.max(0.1, b.w / Math.max(1, b.h));
    // fit the [-1, 1] cloud (and in 3D its floor) into the box, then zoom
    const dist = (1.22 * mix(1, 1.12, c.persp)) / (c.zoom * half * Math.min(1, aspect));
    const target = new THREE.Vector3(c.panX, 0, c.panZ);
    const dir = new THREE.Vector3(
      Math.sin(c.yaw) * Math.sin(c.pitch),
      Math.cos(c.pitch),
      Math.cos(c.yaw) * Math.sin(c.pitch),
    );
    // straight down, the screen's "up" is the floor's far side; from the side it is the sky
    const up = new THREE.Vector3(
      -Math.sin(c.yaw) * Math.cos(c.pitch),
      Math.sin(c.pitch),
      -Math.cos(c.yaw) * Math.cos(c.pitch),
    ).normalize();
    g.cam.fov = fov;
    g.cam.aspect = aspect;
    g.cam.near = dist * 0.02;
    g.cam.far = dist * 6 + 10;
    g.cam.up.copy(up);
    g.cam.position.copy(target).addScaledVector(dir, dist);
    g.cam.lookAt(target);
    g.cam.updateProjectionMatrix();
    g.cam.updateMatrixWorld();
    return dist;
  };

  /** Data coordinates to this pane's screen pixels, and the depth (larger = nearer). */
  const projector = (g: PaneGL) => {
    const m = new THREE.Matrix4().multiplyMatrices(g.cam.projectionMatrix, g.cam.matrixWorldInverse).elements;
    const b = g.box;
    return (x: number, y: number, z: number): [number, number, number] => {
      // three.js coordinates: (x, z, -y)
      const X = x,
        Y = z,
        Z = -y;
      const cx = m[0] * X + m[4] * Y + m[8] * Z + m[12];
      const cy = m[1] * X + m[5] * Y + m[9] * Z + m[13];
      const cw = m[3] * X + m[7] * Y + m[11] * Z + m[15];
      if (cw <= 0) return [-1e4, -1e4, -1e4];
      return [b.x + ((cx / cw + 1) / 2) * b.w, b.y + ((1 - cy / cw) / 2) * b.h, -cw];
    };
  };

  drawRef.current = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  };

  function draw(now: number) {
    const { panes: ps, size: s } = props.current;
    const overlay = overlayRef.current;
    if (!overlay || !s.w) return;
    sync(ps);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = overlay.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    const r = renderer.current;
    const light = isLight();

    // camera and field box ease towards their goals
    const c = cam.current,
      g0 = goal.current;
    let moving = false;
    const want = props.current.insets;
    for (const k of ["l", "r", "t", "b"] as const) {
      const d = want[k] - box.current[k];
      if (Math.abs(d) > 0.5 && !reducedMotion()) {
        box.current[k] += d * 0.16;
        moving = true;
      } else box.current[k] = want[k];
    }
    for (const k of ["yaw", "pitch", "persp", "zoom", "panX", "panZ"] as const) {
      const d = g0[k] - c[k];
      if (Math.abs(d) > 1e-4) {
        c[k] += d * 0.12;
        moving = true;
      } else c[k] = g0[k];
    }
    const dt = Math.min(0.1, (now - (lastFrame.current || now)) / 1000);
    lastFrame.current = now;
    if (props.current.three && !reducedMotion() && !hoverRef.current && !drag.current) {
      if (now - lastTouch.current > IDLE_MS) {
        g0.yaw += SPIN * dt;
        c.yaw += SPIN * dt;
      }
      moving = true;
    }

    const ink = cssVar("--ink"),
      ink2 = cssVar("--ink-2"),
      ink3 = cssVar("--ink-3");
    const sweep = cssVar("--sweep-hi"),
      lost = cssVar("--lost");
    const hov = hoverRef.current;
    const tsec = reducedMotion() ? 0 : now / 1000;

    if (r) {
      r.setScissorTest(false);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.setScissorTest(true);
    }

    boxes().forEach((bx, pi) => {
      const pane = ps[pi];
      const g = pane && gls.current.get(pane.key);
      if (!pane || !g) return;
      g.box = bx;
      const dist = aim(g, c, bx);

      // fly to a newly picked question
      if (pi === 0 && (pane.focus?.id ?? null) !== g.focusId) {
        g.focusId = pane.focus?.id ?? null;
        if (pane.focus && !reducedMotion()) {
          goal.current = {
            ...goal.current,
            panX: pane.focus.x,
            panZ: -pane.focus.y,
            zoom: Math.max(goal.current.zoom, 1.8),
          };
          moving = true;
        }
      }

      // positions this frame
      const t = g.dur ? Math.min(1, (now - g.t0) / g.dur) : 1;
      if (t < 1) moving = true;
      const k = ease(t);
      // rising out of the sea: each chunk sets off a little after the one before, so the space gathers
      const kOf = (id: number) => {
        if (!g.intro) return k;
        const delay = hash01(id) * 0.4;
        return ease(Math.min(1, Math.max(0, (t - delay) / 0.6)));
      };
      const posAttr = g.geo.getAttribute("position") as THREE.BufferAttribute;
      const alphaAttr = g.geo.getAttribute("aAlpha") as THREE.BufferAttribute;
      if (t < 1 || g.look.colors === null) {
        g.points.forEach((p, i) => {
          const f = g.from.get(p.id);
          const kp = kOf(p.id);
          const x = f ? f[0] + (p.x - f[0]) * kp : p.x,
            y = f ? f[1] + (p.y - f[1]) * kp : p.y,
            z = f ? f[2] + (p.z - f[2]) * kp : p.z;
          g.pos[i * 3] = x;
          g.pos[i * 3 + 1] = y;
          g.pos[i * 3 + 2] = z;
          posAttr.setXYZ(i, x, z, -y);
        });
        posAttr.needsUpdate = true;
      }

      // colours, filters, emphasis and the shells follow what the page shows
      const lookChanged =
        g.look.colors !== pane.colors ||
        g.look.visible !== pane.visible ||
        g.look.emphasis !== pane.emphasis ||
        g.look.light !== light;
      if (lookChanged || t < 1) {
        if (g.look.colors !== pane.colors || g.look.visible !== pane.visible || g.look.light !== light)
          rebuildShells(g, pane, light);
        const colAttr = g.geo.getAttribute("aColor") as THREE.BufferAttribute;
        const col = new THREE.Color();
        g.points.forEach((p, i) => {
          const hex = pane.colors[i] || ink2;
          col.set(hex);
          colAttr.setXYZ(i, col.r, col.g, col.b);
          const shown = !pane.visible || pane.visible[i];
          const fresh = g.from.size && !g.from.has(p.id) && !g.intro ? k : 1;
          const base = pane.emphasis && !pane.emphasis.has(p.id) ? 0.14 : 0.92;
          alphaAttr.setX(i, shown ? base * fresh : 0);
        });
        colAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
        g.look = { colors: pane.colors, visible: pane.visible, emphasis: pane.emphasis, light };
      }

      // the shells: centred on their group as it moves; they turn and breathe in the shader
      for (const sh of g.shells) {
        let cx = 0,
          cy = 0,
          cz = 0;
        for (const i of sh.idx) {
          cx += g.pos[i * 3];
          cy += g.pos[i * 3 + 1];
          cz += g.pos[i * 3 + 2];
        }
        const n = sh.idx.length;
        const u = sh.mat.uniforms;
        u.uCenter.value.set(cx / n, cz / n, -cy / n);
        u.uTime.value = tsec;
        u.uPersp.value = c.persp;
        u.uRefDist.value = dist;
        u.uPixel.value = dpr;
        const dimmed = pane.emphasis && !sh.idx.some((i) => pane.emphasis!.has(g.points[i].id));
        // shells appear once their points have gathered
        const arrived = g.intro ? Math.max(0, (t - 0.7) / 0.3) : 1;
        u.uFade.value = (dimmed ? 0.25 : 1) * arrived;
      }
      if (g.shells.length && !reducedMotion()) moving = true;

      g.floor.visible = false;
      if (pointMat.current) {
        pointMat.current.uniforms.uPersp.value = c.persp;
        pointMat.current.uniforms.uRefDist.value = dist;
      }

      if (r) {
        const H = s.h;
        r.setViewport(bx.x, H - bx.y - bx.h, bx.w, bx.h);
        r.setScissor(bx.x, H - bx.y - bx.h, bx.w, bx.h);
        r.render(g.scene, g.cam);
      }

      // ---------- the crisp marks, on the 2D layer ----------
      const project = projector(g);
      ctx.save();
      if (ps.length > 1) {
        ctx.beginPath();
        ctx.rect(bx.x - 20, bx.y - 20, bx.w + 40, bx.h + 40);
        ctx.clip();
      }
      const at = (id: number | null | undefined) => (id != null ? g.index.get(id) : undefined);
      const screen = (i: number) => project(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);

      // 3D: a dashed line from a point down to the floor, for the points that matter
      const drop = (x: number, y: number, z: number) => {
        if (c.persp < 0.01 || !SHOW_DROPS) return;
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
        const i = at(id);
        if (i != null) drop(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
      };
      for (const h of pane.hits) dropId(h.id);
      dropId(pane.selected);
      if (hov?.pane === pi && hov.kind === "chunk") dropId(hov.id);
      if (pane.focus) drop(pane.focus.x, pane.focus.y, pane.focus.z);

      // the other pane's pointer: same chunk (or its document's chunks) ringed in ink
      if (pane.linked) {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        for (const id of pane.linked) {
          const i = at(id);
          if (i == null) continue;
          const [x, y] = screen(i);
          ring(ctx, x, y, 6);
        }
      }

      // true neighbours of the selected chunk: thin lines and rings
      const sel = at(pane.selected);
      if (sel != null) {
        const [sx, sy] = screen(sel);
        ctx.strokeStyle = ink2;
        ctx.lineWidth = 1;
        for (const id of pane.neighbours) {
          const i = at(id);
          if (i == null) continue;
          const [x, y] = screen(i);
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ring(ctx, x, y, 5);
        }
      }

      // every question, as small hollow diamonds
      g.qx = [];
      g.qy = [];
      ctx.strokeStyle = ink3;
      ctx.lineWidth = 1;
      for (const q of pane.queries) {
        const [qx, qy] = project(q.x, q.y, q.z);
        g.qx.push(qx);
        g.qy.push(qy);
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
        const [x, y] = screen(i);
        ring(ctx, x, y, 6);
        cross(ctx, x, y, 3);
      }
      if (focus) {
        const goldLine = cssVar("--gold-line");
        for (const h of pane.hits) {
          const i = at(h.id);
          if (i == null) continue;
          const [x, y] = screen(i);
          ctx.beginPath();
          ctx.moveTo(focus[0], focus[1]);
          ctx.lineTo(x, y);
          ctx.strokeStyle = h.relevant ? goldLine : cssVar("--hit-line");
          ctx.lineWidth = h.relevant ? 1.3 : 1;
          ctx.stroke();
        }
      }
      ctx.font = FONT;
      for (const h of pane.hits) {
        const i = at(h.id);
        if (i == null) continue;
        const [x, y] = screen(i);
        ctx.fillStyle = sweep;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (h.relevant) {
          ctx.strokeStyle = cssVar("--gold-hi");
          ctx.lineWidth = 1.2;
          ring(ctx, x, y, 7);
        }
        tag(ctx, String(h.rank), x + 8, y - 17, ink);
      }
      if (focus && pane.focus) {
        ctx.fillStyle = ink;
        diamond(ctx, focus[0], focus[1], 6);
        ctx.fill();
        tag(ctx, pane.focus.label, focus[0] + 10, focus[1] + 4, ink);
      }

      // the selected chunk: a wash with an ink ring
      if (sel != null) {
        const [x, y] = screen(sel);
        ctx.fillStyle = cssVar("--sweep-wash");
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ring(ctx, x, y, 7);
      }

      // what the pointer is on
      if (hov && hov.pane === pi) {
        const p = hov.kind === "chunk" ? at(hov.id) : undefined;
        const qi = hov.kind === "query" ? pane.queries.findIndex((q) => q.id === hov.id) : -1;
        const xy = p != null ? screen(p) : qi >= 0 ? [g.qx[qi], g.qy[qi]] : null;
        if (xy) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1;
          ring(ctx, xy[0], xy[1], 6);
        }
      }

      if (pane.label) {
        ctx.font = FONT;
        ctx.fillStyle = ink3;
        ctx.fillText(pane.label.toUpperCase(), bx.x, bx.y - 14);
      }
      ctx.restore();
    });
    r?.setScissorTest(false);

    if (moving) frame.current = requestAnimationFrame(draw);
  }

  // redraw whenever anything shown changes
  useEffect(() => {
    drawRef.current();
  });

  // ---------- pointer ----------

  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean } | null>(null);

  const find = (mx: number, my: number): Omit<Target, "clientX" | "clientY"> | null => {
    const { panes: ps } = props.current;
    let best: Omit<Target, "clientX" | "clientY"> | null = null;
    let bestD = 64; // 8px radius, squared
    ps.forEach((pane, pi) => {
      const g = gls.current.get(pane.key);
      if (!g) return;
      pane.queries.forEach((q, qi) => {
        const d = (g.qx[qi] - mx) ** 2 + (g.qy[qi] - my) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { pane: pi, kind: "query", id: q.id };
        }
      });
      const project = projector(g);
      for (let i = 0; i < g.points.length; i++) {
        if (pane.visible && !pane.visible[i]) continue;
        const [x, y] = project(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
        const d = (x - mx) ** 2 + (y - my) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { pane: pi, kind: "chunk", id: g.points[i].id };
        }
      }
    });
    return best;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };

  /** World units per screen pixel at the camera's target, for panning. */
  const worldPerPx = () => {
    const g = gls.current.values().next().value as PaneGL | undefined;
    if (!g) return 0.003;
    const c = cam.current;
    const dist = g.cam.position.distanceTo(new THREE.Vector3(c.panX, 0, c.panZ));
    return (2 * dist * Math.tan(((g.cam.fov / 2) * Math.PI) / 180)) / Math.max(1, g.box.h);
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
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      const g = goal.current,
        c = cam.current;
      if (d.pan) {
        // move the target against the drag, along the floor, in the camera's own left/right and up/down
        const wpp = worldPerPx();
        const rx = Math.cos(c.yaw),
          rz = -Math.sin(c.yaw);
        const ux = -Math.sin(c.yaw),
          uz = -Math.cos(c.yaw);
        g.panX += -dx * wpp * rx + dy * wpp * ux;
        g.panZ += -dx * wpp * rz + dy * wpp * uz;
        c.panX = g.panX;
        c.panZ = g.panZ;
      } else {
        g.yaw -= dx * 0.008;
        g.pitch = Math.max(0, Math.min(1.45, g.pitch + dy * 0.008)); // straight down to the side, never under the floor
        c.yaw = g.yaw;
        c.pitch = g.pitch;
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
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastTouch.current = performance.now();
      const g = goal.current,
        c = cam.current;
      const z = Math.min(30, Math.max(0.4, g.zoom * Math.exp(-e.deltaY * 0.0015)));
      const [mx, my] = local(e);
      const pg = [...gls.current.values()].find(
        (p) => mx >= p.box.x && mx <= p.box.x + p.box.w && my >= p.box.y && my <= p.box.y + p.box.h,
      );
      if (pg) {
        // keep the floor point under the pointer where it is
        const floorAt = (state: Camera) => {
          aim(pg, state, pg.box);
          const ndc = new THREE.Vector2(((mx - pg.box.x) / pg.box.w) * 2 - 1, -((my - pg.box.y) / pg.box.h) * 2 + 1);
          const ray = new THREE.Raycaster();
          ray.setFromCamera(ndc, pg.cam);
          const hit = new THREE.Vector3();
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          return ray.ray.intersectPlane(plane, hit) ? hit : null;
        };
        const before = floorAt({ ...g });
        const after = floorAt({ ...g, zoom: z });
        if (before && after) {
          g.panX += before.x - after.x;
          g.panZ += before.z - after.z;
        }
        aim(pg, c, pg.box);
      }
      g.zoom = z;
      Object.assign(c, { zoom: g.zoom, panX: g.panX, panZ: g.panZ });
      drawRef.current();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className="space-wrap">
      <canvas ref={glRef} className="space-gl" style={{ width: size.w, height: size.h }} aria-hidden />
      <canvas
        ref={overlayRef}
        className={`space-canvas ${three ? "orbit" : ""}`}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (!drag.current) {
            hoverRef.current = null;
            onHover(null);
          }
          drawRef.current();
        }}
        onContextMenu={(e) => e.preventDefault()}
        role="img"
        aria-label={label}
      />
    </div>
  );
}

// ---------- building and disposing a pane's GPU objects ----------

function makePane(
  points: PanePoint[],
  from: Map<number, [number, number, number]>,
  dur: number,
  mat: THREE.ShaderMaterial | null,
): PaneGL {
  const n = points.length;
  const pos = new Float32Array(n * 3);
  const gpu = new Float32Array(n * 3);
  points.forEach((p, i) => {
    const [x, y, z] = from.get(p.id) ?? [p.x, p.y, p.z];
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    gpu[i * 3] = x;
    gpu[i * 3 + 1] = z;
    gpu[i * 3 + 2] = -y;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(gpu, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1));
  const scene = new THREE.Scene();
  const cloud = new THREE.Points(geo, mat ?? new THREE.PointsMaterial({ size: 2 }));
  cloud.frustumCulled = false;
  cloud.renderOrder = 2;
  scene.add(cloud);

  // the floor grid, shown in 3D
  const lines: number[] = [];
  for (let v = -1; v <= 1.001; v += 0.25) lines.push(v, FLOOR, -1, v, FLOOR, 1, -1, FLOOR, v, 1, FLOOR, v);
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const floor = new THREE.LineSegments(
    floorGeo,
    new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar("--ink-3") || "#888"), transparent: true, opacity: 0 }),
  );
  floor.renderOrder = 0;
  scene.add(floor);

  return {
    points,
    from,
    t0: performance.now(),
    dur,
    pos,
    index: new Map(points.map((p, i) => [p.id, i])),
    scene,
    geo,
    cloud,
    floor,
    shells: [],
    look: { colors: null, visible: null, emphasis: null, light: false },
    cam: new THREE.PerspectiveCamera(42, 1, 0.01, 100),
    box: { x: 0, y: 0, w: 1, h: 1 },
    qx: [],
    qy: [],
    focusId: null,
    intro: false,
  };
}

function disposePane(g: PaneGL) {
  for (const sh of g.shells) {
    sh.obj.geometry.dispose();
    sh.mat.dispose();
  }
  g.geo.dispose();
  g.floor.geometry.dispose();
  (g.floor.material as THREE.Material).dispose();
}

/** The coloured groups worth a shell: at most SHELL_MAX_GROUPS colours, each with enough points. */
function rebuildShells(g: PaneGL, pane: Pane, light: boolean) {
  for (const sh of g.shells) {
    g.scene.remove(sh.obj);
    sh.obj.geometry.dispose();
    sh.mat.dispose();
  }
  g.shells = [];
  const groups = new Map<string, number[]>();
  g.points.forEach((_, i) => {
    if (pane.visible && !pane.visible[i]) return;
    const c = pane.colors[i];
    if (!c) return;
    const list = groups.get(c);
    if (list) list.push(i);
    else groups.set(c, [i]);
  });
  if (groups.size > SHELL_MAX_GROUPS) return;
  let seed = 0;
  for (const [color, idx] of groups) {
    seed += 1.7;
    if (idx.length < SHELL_MIN_POINTS) continue;
    // the shell holds about 80% of the group (final positions): a radius a few strays don't blow up
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const i of idx) {
      cx += g.points[i].x;
      cy += g.points[i].y;
      cz += g.points[i].z;
    }
    cx /= idx.length;
    cy /= idx.length;
    cz /= idx.length;
    const d = idx
      .map((i) => Math.hypot(g.points[i].x - cx, g.points[i].y - cy, g.points[i].z - cz))
      .sort((a, b) => a - b);
    const r = Math.max(0.05, d[Math.floor(d.length * 0.8)] * 1.08);
    const n = Math.min(SPHERE.length, Math.round(160 + Math.sqrt(idx.length) * 16));
    const step = SPHERE.length / n;
    const lattice = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const u = SPHERE[Math.floor(k * step)];
      lattice[k * 3] = u[0];
      lattice[k * 3 + 1] = u[1];
      lattice[k * 3 + 2] = u[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(lattice, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: shellVertex,
      fragmentShader: shellFragment,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uR: { value: r },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uPixel: { value: 1 },
        uPersp: { value: 0 },
        uRefDist: { value: 1 },
        uFade: { value: 1 },
        uBase: { value: light ? 0.1 : 0.08 },
        uColor: { value: new THREE.Color(color) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const obj = new THREE.Points(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = 1;
    g.scene.add(obj);
    g.shells.push({ color, idx, r, seed, obj, mat });
  }
}

// ---------- 2D marks ----------

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

/** A small numeral or id on a label the colour of the ground, the scene's only kind of text. */
function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string) {
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = cssVar("--tag-bg");
  ctx.beginPath();
  ctx.roundRect(x, y, w, 16, 4);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.fillText(text, x + 4, y + 12);
}
