import { useEffect, useRef } from "react";
import * as THREE from "three";
import { motionOff, useMotion } from "../state/motion";

/**
 * The ground every page stands on: a pool of dots seen from slightly above, receding into the dark. The
 * surface flows slowly towards the viewer, low swells roll across it, wave packets lift and drop the dots
 * they pass (like excitations in a particle field), a few lone dots bob on their own, and the surface rises
 * a little under the pointer. Everything moves on the GPU, in one shader.
 *
 * Faint by design: text never sits on it directly (the veil in global.css blacks it out under anything you
 * read). Questions get the calm version; Space draws its own field and gets none.
 */
export type PoolMode = "overview" | "calm" | "off";

const COLS = 240;
const ROWS = 150;
const GAP = 0.32; // world units between dots
const FLOW = 0.55; // units per second towards the viewer

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform float uDepth;      // length of the pool along z, for wrapping the flow
  uniform float uWidth;      // width of the pool along x, for wrapping the fast particles
  uniform vec3 uPointer;     // where the pointer meets the surface (y unused)
  uniform float uPointerOn;
  uniform float uPixel;      // device pixel ratio
  attribute float aSeed;
  varying float vLift;
  varying float vFade;
  varying float vTwinkle;

  // a packet: a short wave train under a moving gaussian
  float packet(vec2 p, vec2 c, vec2 v, float sigma, float k, float t) {
    vec2 at = c + v * t;
    vec2 d = p - at;
    float env = exp(-dot(d, d) / (2.0 * sigma * sigma));
    return env * sin(dot(d, normalize(v)) * k - t * 2.4);
  }

  void main() {
    vec3 p = position;
    float t = uTime;
    // a fast particle: one dot in eight streaks through the field on its own current
    float fast = step(0.875, aSeed);
    // the current: every dot drifts towards the viewer and meanders sideways along slowly shifting streams
    float speed = uFlow * (1.0 + fast * (3.0 + aSeed * 4.0));
    p.z += t * speed;
    p.x += 0.55 * sin(p.z * 0.23 + t * 0.35 + aSeed * 6.2831) + fast * t * (aSeed - 0.94) * 2.5;
    p.z += 0.35 * cos(p.x * 0.27 - t * 0.28);
    p.z = mod(p.z + uDepth * 0.5, uDepth) - uDepth * 0.5;
    p.x = mod(p.x + uWidth * 0.5, uWidth) - uWidth * 0.5;

    float y = 0.0;
    // swells
    y += 0.16 * sin(p.x * 0.33 + t * 0.55) * sin(p.z * 0.26 - t * 0.42);
    y += 0.09 * sin((p.x + p.z) * 0.21 + t * 0.33);
    // wave packets crossing the pool, each on its own loop
    float l1 = mod(t, 34.0), l2 = mod(t + 13.0, 38.0), l3 = mod(t + 25.0, 29.0);
    y += 0.5 * packet(p.xz, vec2(-24.0, -8.0), vec2(1.5, 0.15), 3.0, 2.2, l1);
    y += 0.42 * packet(p.xz, vec2(22.0, -14.0), vec2(-1.3, 0.3), 2.6, 2.6, l2);
    y += 0.45 * packet(p.xz, vec2(-6.0, -22.0), vec2(0.2, 1.4), 2.8, 2.0, l3);
    // single dots rise and fall on their own
    float lone = step(0.94, aSeed) * (1.0 - fast);
    y += lone * 0.45 * sin(t * (0.8 + aSeed * 2.0) + aSeed * 60.0);
    y += fast * 0.25 * sin(t * 3.0 + aSeed * 40.0);
    // the surface rises a little under the pointer
    vec2 dp = p.xz - uPointer.xz;
    y += uPointerOn * 0.5 * exp(-dot(dp, dp) / 4.0);
    p.y += y;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    gl_PointSize = uPixel * (1.5 + 1.8 * clamp(abs(y) * 1.8, 0.0, 1.0) + fast * 1.2) * (9.0 / dist);
    vLift = clamp(abs(y) * 2.0 + lone * 0.3 + fast * 0.55, 0.0, 1.0);
    vTwinkle = 0.75 + 0.25 * sin(t * (1.5 + aSeed * 3.0) + aSeed * 100.0);
    // fade with distance (no visible horizon) and right in front of the camera
    vFade = smoothstep(40.0, 9.0, dist) * smoothstep(1.5, 4.0, dist);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vLift;
  varying float vFade;
  varying float vTwinkle;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.1, r);
    float a = (0.2 + 0.7 * vLift) * vTwinkle * vFade * soft * uStrength;
    gl_FragColor = vec4(uColor, a);
  }
`;

export function DotPool({ mode }: { mode: PoolMode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // the effect starts over when the Motion setting changes
  const { motion } = useMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    } catch {
      return; // no WebGL: the page simply has a plain black ground
    }
    const reduced = motionOff();
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
    camera.position.set(0, 3.1, 9);
    camera.lookAt(0, 0, -6);

    // the dots: a grid on the xz plane, with a random seed each
    const n = COLS * ROWS;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    let k = 0;
    for (let j = 0; j < ROWS; j++)
      for (let i = 0; i < COLS; i++, k++) {
        pos[k * 3] = (i - COLS / 2) * GAP;
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = (j - ROWS / 2) * GAP - 8;
        seed[k] = Math.random();
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const uniforms = {
      uTime: { value: 0 },
      uFlow: { value: FLOW },
      uDepth: { value: ROWS * GAP },
      uWidth: { value: COLS * GAP },
      uPointer: { value: new THREE.Vector3(0, 0, 999) },
      uPointerOn: { value: 0 },
      uPixel: { value: 1 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uStrength: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);

    const readTheme = () => {
      const light = document.documentElement.dataset.theme === "light";
      uniforms.uColor.value.set(light ? 0x000000 : 0xffffff);
    };
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      renderer.setPixelRatio(dpr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      uniforms.uPixel.value = dpr;
    };

    // the pointer, projected onto the surface
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    let pointerGoal = 0;
    const onMove = (e: PointerEvent) => {
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, hit)) {
        uniforms.uPointer.value.copy(hit);
        pointerGoal = 1;
      }
    };
    const onLeave = () => (pointerGoal = 0);

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const m = modeRef.current;
      const target = m === "off" ? 0 : m === "calm" ? 0.5 : 1;
      const light = document.documentElement.dataset.theme === "light";
      uniforms.uStrength.value += ((light ? target * 0.7 : target) - uniforms.uStrength.value) * 0.05;
      uniforms.uPointerOn.value += (pointerGoal - uniforms.uPointerOn.value) * 0.06;
      uniforms.uTime.value = reduced ? 20 : (now - start) / 1000;
      if (uniforms.uStrength.value > 0.002) renderer.render(scene, camera);
      else renderer.clear();
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    readTheme();
    resize();
    if (reduced) {
      uniforms.uStrength.value = modeRef.current === "off" ? 0 : 1;
      frame(performance.now());
    } else raf = requestAnimationFrame(frame);

    const theme = new MutationObserver(readTheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      theme.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
    };
  }, [motion]);

  return <canvas ref={ref} className="dot-pool" aria-hidden />;
}
