import type { Json, JsonObject } from "../api/types";

/** {"a": {"b": 1}, "c": [1, 2]} -> [["a.b", 1], ["c", [1, 2]]]   (same rule as lab.jsonb_flatten) */
export function flatten(obj: JsonObject | null | undefined, prefix = ""): [string, Json][] {
  if (!obj) return [];
  const out: [string, Json][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) out.push(...flatten(v, path));
    else out.push([path, v]);
  }
  return out;
}

export function showValue(v: Json | undefined): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : String(v);
  if (Array.isArray(v)) return v.map((x) => showValue(x)).join(", ");
  return JSON.stringify(v);
}

// Short names for setting keys we know. Any other key still renders, as its own path.
const KEY_LABEL: Record<string, string> = {
  top_k: "k",
  dense_k: "dense k",
  sparse_k: "sparse k",
  top_n: "top n",
  candidates: "candidates",
  size: "size",
  overlap: "overlap",
  dim: "dim",
  temperature: "temp",
  max_tokens: "max tok",
  strategy: "",
  method: "",
  mode: "",
  template: "",
  "prompt.template": "",
  version: "v",
  "prompt.version": "prompt v",
  model: "model",
  k: "k",
  n: "n",
  k1: "k1",
  b: "b",
  rubric: "rubric",
  name: "",
  inputs: "from",
};

// Keys shown elsewhere (as the LOCAL/CLOUD badge) or that are noise on a card.
const HIDDEN = new Set(["provider", "location", "unit", "separators", "normalize", "hash"]);

export interface ConfigChip {
  path: string; // full diff path, e.g. "steps.rerank.top_n"
  label: string; // short key, may be empty
  value: string;
  known: boolean;
}

/** The chips for one step card. `prefix` is the step's diff prefix ("steps.rerank", "chunking"). */
export function stepChips(config: JsonObject | null | undefined, prefix: string): ConfigChip[] {
  return flatten(config)
    .filter(([path]) => !HIDDEN.has(path.split(".").pop()!))
    .map(([path, v]) => {
      const label = path in KEY_LABEL ? KEY_LABEL[path] : undefined;
      return { path: `${prefix}.${path}`, label: label ?? path, value: showValue(v), known: label !== undefined };
    });
}

/** Set "a.b.c" = value inside a nested object, creating levels as needed (returns a new object). */
export function setPath(obj: JsonObject, path: string, value: Json): JsonObject {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) return { ...obj, [head]: value };
  const child = obj[head];
  const base = child && typeof child === "object" && !Array.isArray(child) ? (child as JsonObject) : {};
  return { ...obj, [head]: setPath(base, rest.join("."), value) };
}
