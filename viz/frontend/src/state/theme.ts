import { useSyncExternalStore } from "react";

// Light or dark. "system" follows the operating system. The choice is kept in this browser
// (localStorage); index.html applies it before the first paint, so the page never flashes.
// CSS reads <html data-theme="light|dark">: styles/global.css holds the dark tokens on :root and the light ones
// on :root[data-theme="light"].

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "rag-lab.theme";
const media = window.matchMedia("(prefers-color-scheme: light)");
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let pref = readPref();
const resolve = (p: ThemePref): Theme => (p === "system" ? (media.matches ? "light" : "dark") : p);
let theme = resolve(pref);
let snapshot = { pref, theme };

function apply() {
  theme = resolve(pref);
  snapshot = { pref, theme };
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  listeners.forEach((l) => l());
}

media.addEventListener("change", () => { if (pref === "system") apply(); });
apply();

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // storage blocked: the choice lasts until reload
  }
  apply();
}

/** The chosen preference and the theme actually shown. Re-renders when either changes. */
export function useTheme(): { pref: ThemePref; theme: Theme } {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => snapshot,
  );
}
