import { useSyncExternalStore } from "react";

// Motion: on or off. On by default (the owner wants the app to move, and their system asks to reduce motion);
// "system" follows the operating system's "reduce motion" setting, "off" stops everything.
// Kept in this browser (localStorage); index.html applies it before the first paint. Everything that moves
// reads <html data-motion="on|off"> through motionOff(), and CSS through :root[data-motion="off"].

export type MotionPref = "system" | "on" | "off";

const KEY = "rag-lab.motion";
const media = window.matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set<() => void>();

function readPref(): MotionPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "system" || v === "off" ? v : "on";
  } catch {
    return "on";
  }
}

let pref = readPref();
const resolve = (p: MotionPref): "on" | "off" => (p === "system" ? (media.matches ? "off" : "on") : p);
let snapshot = { pref, motion: resolve(pref) };

function apply() {
  snapshot = { pref, motion: resolve(pref) };
  document.documentElement.dataset.motion = snapshot.motion;
  listeners.forEach((l) => l());
}

media.addEventListener("change", () => {
  if (pref === "system") apply();
});
apply();

/** True when nothing should move. Read it when a motion starts, not once at load. */
export const motionOff = () => document.documentElement.dataset.motion === "off";

export function setMotionPref(next: MotionPref) {
  pref = next;
  try {
    if (next === "on") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  apply();
}

/** The chosen preference and what is in effect. Re-renders when either changes. */
export function useMotion(): { pref: MotionPref; motion: "on" | "off" } {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => snapshot,
  );
}
