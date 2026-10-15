// Fields: everything the Space page can colour, filter and show for a chunk, discovered from the data.
//
// Nothing here knows what the corpus is (Jira tickets, GitHub PRs, spreadsheets, ...). A field is
// one of: a document column, a key in document.metadata or chunk.metadata, a chunk measure, the
// spike's cluster id, or how the latest run retrieved the chunk. Its kind is detected from its values
// and can be overridden on the page (lab.field_style, saved per corpus name).

import type { FieldKind, FieldStyle, Json, JsonObject, RunHit, SpacePoint } from "../api/types";
import { flatten } from "./config";
import { stepRank } from "./steps";

export type FieldGroup = "document" | "chunk" | "space" | "retrieval";
export const GROUP_LABEL: Record<FieldGroup, string> = {
  document: "Document",
  chunk: "Chunk",
  space: "Space",
  retrieval: "Retrieval (latest run)",
};

/** A value after typing: a string (category, text), a number (number, date as epoch ms), or null. */
export type Value = string | number | null;

export interface Field {
  id: string;                // 'document.source', 'chunk.metadata.section', 'retrieval.outcome'
  group: FieldGroup;
  label: string;
  kind: FieldKind;           // what the page uses: the override, or the detected kind
  detected: FieldKind;
  hidden: boolean;
  style: FieldStyle | undefined;
  values: Value[];           // one per point, in the points' order
  present: number;           // points with a value
  distinct: number;
  /** category: values by count, most common first */
  categories: { value: string; count: number }[];
  min: number | null;        // number / date
  max: number | null;
}

/** A field is worth colouring or filtering by when it varies. */
export const usable = (f: Field) => !f.hidden && f.distinct > 1 && f.kind !== "text";

const MAX_CATEGORIES = 30;   // more distinct strings than this: detected as text
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

type Raw = Json | undefined;

function rawToString(v: Raw): string | null {
  if (v == null || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.map((x) => rawToString(x) ?? "").join(", ") : null;
  if (typeof v === "object") return Object.keys(v).length ? JSON.stringify(v) : null;
  return String(v);
}

function detect(raw: Raw[]): FieldKind {
  const vals = raw.filter((v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (!vals.length) return "text";
  if (vals.every((v) => typeof v === "number")) return "number";
  if (vals.every((v) => typeof v === "string" && ISO_DATE.test(v))) return "date";
  if (vals.every((v) => typeof v === "string" && NUMERIC.test(v.trim()))) return "number";
  if (vals.every((v) => typeof v === "boolean")) return "category";
  return new Set(vals.map(rawToString)).size <= MAX_CATEGORIES ? "category" : "text";
}

function typed(v: Raw, kind: FieldKind): Value {
  if (v == null || v === "") return null;
  switch (kind) {
    case "number": {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case "date": {
      const t = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN;
      return Number.isFinite(t) ? t : null;
    }
    default:
      return rawToString(v);
  }
}

/** "document.metadata.issue_type" -> "Issue type" */
export function humanize(id: string): string {
  const last = id.split(".").pop() ?? id;
  const s = last.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const FIXED_LABEL: Record<string, string> = {
  "document.title": "Document",
  "document.external_id": "Document id",
  "document.doc_date": "Date",
  "chunk.tokens": "Tokens",
  "chunk.chars": "Characters",
  "chunk.position": "Position in document",
  "space.cluster": "Cluster",
  "retrieval.outcome": "Outcome",
  "retrieval.retrieved": "Retrieved by (questions)",
  "retrieval.relevant": "Relevant to (questions)",
};

/** How the latest run treated each chunk, across every question of the eval set. */
export interface RetrievalStats {
  stage: string | undefined;            // the final stage: the last step in order that wrote lists
  retrieved: Map<number, number>;       // chunk -> questions whose final list has it
  relevant: Map<number, number>;        // chunk -> questions it is relevant to
  outcome: Map<number, Outcome>;
}

export type Outcome = "found" | "partly found" | "never found" | "noise" | "unused";
export const OUTCOME_COLORS: Record<Outcome, string> = {
  "found": "--cat-6",
  "partly found": "--cat-5",
  "never found": "--lost",          // the same amber as "a relevant chunk it missed"
  "noise": "--cat-7",
  "unused": "--ink-3",
};
export const OUTCOME_TEXT: Record<Outcome, string> = {
  "found": "relevant to some questions, and retrieved for all of them",
  "partly found": "relevant to several questions, retrieved for only some",
  "never found": "relevant to some questions, never retrieved for them",
  "noise": "retrieved, but never for a question it is relevant to",
  "unused": "never retrieved and relevant to no question",
};

/** The final stage of a run: the last step, in the version's order, that wrote ranked lists. */
export function finalStageOfRun(hits: RunHit[], stepIds: string[]): string | undefined {
  const stages = [...new Set(hits.map((h) => h.stage))];
  stages.sort((a, b) => stepRank(stepIds, a) - stepRank(stepIds, b) || a.localeCompare(b));
  return stages[stages.length - 1];
}

export function retrievalStats(
  hits: RunHit[] | undefined, relevantPairs: { question_id: number; chunk_id: number }[] | undefined, stepIds: string[],
): RetrievalStats | undefined {
  if (!hits || !relevantPairs || !hits.length) return undefined;
  const stage = finalStageOfRun(hits, stepIds);
  const questions = new Set(hits.map((h) => h.question_id));
  const finalPairs = new Set<string>();
  const retrieved = new Map<number, number>();
  for (const h of hits) {
    if (h.stage !== stage) continue;
    const key = `${h.question_id}:${h.chunk_id}`;
    if (finalPairs.has(key)) continue;
    finalPairs.add(key);
    retrieved.set(h.chunk_id, (retrieved.get(h.chunk_id) ?? 0) + 1);
  }
  const relevant = new Map<number, number>();
  const relevantFound = new Map<number, number>();
  const relevantPairsByChunk = new Set<string>();
  for (const r of relevantPairs) {
    if (!questions.has(r.question_id)) continue;    // only questions this run answered
    relevant.set(r.chunk_id, (relevant.get(r.chunk_id) ?? 0) + 1);
    relevantPairsByChunk.add(`${r.question_id}:${r.chunk_id}`);
    if (finalPairs.has(`${r.question_id}:${r.chunk_id}`)) relevantFound.set(r.chunk_id, (relevantFound.get(r.chunk_id) ?? 0) + 1);
  }
  const outcome = new Map<number, Outcome>();
  const ids = new Set([...retrieved.keys(), ...relevant.keys()]);
  for (const id of ids) {
    const rel = relevant.get(id) ?? 0;
    const found = relevantFound.get(id) ?? 0;
    outcome.set(id, rel === 0 ? "noise" : found === rel ? "found" : found === 0 ? "never found" : "partly found");
  }
  return { stage, retrieved, relevant, outcome };
}

interface Source {
  id: string;
  group: FieldGroup;
  raw: (p: SpacePoint) => Raw;
  kind?: FieldKind;          // fixed kind (no detection)
}

function sources(points: SpacePoint[], stats: RetrievalStats | undefined): Source[] {
  const out: Source[] = [
    { id: "document.title", group: "document", raw: (p) => p.document_title },
    { id: "document.source", group: "document", raw: (p) => p.source },
    { id: "document.project", group: "document", raw: (p) => p.project },
    { id: "document.author", group: "document", raw: (p) => p.author },
    { id: "document.doc_date", group: "document", raw: (p) => p.doc_date, kind: "date" },
    { id: "document.external_id", group: "document", raw: (p) => p.document_external_id },
  ];
  // every metadata key that appears anywhere (nested objects become dotted paths)
  const docKeys = new Set<string>();
  const chunkKeys = new Set<string>();
  const seenDocs = new Set<number>();
  for (const p of points) {
    if (!seenDocs.has(p.document_id)) {
      seenDocs.add(p.document_id);
      for (const [k] of flatten(p.document_metadata)) docKeys.add(k);
    }
    for (const [k] of flatten(p.chunk_metadata)) chunkKeys.add(k);
  }
  const at = (obj: JsonObject | null | undefined, path: string): Raw => {
    let cur: Raw = obj ?? undefined;
    for (const part of path.split(".")) {
      if (cur == null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as JsonObject)[part];
    }
    return cur;
  };
  for (const k of [...docKeys].sort()) out.push({ id: `document.metadata.${k}`, group: "document", raw: (p) => at(p.document_metadata, k) });
  out.push(
    { id: "chunk.tokens", group: "chunk", raw: (p) => p.token_count, kind: "number" },
    { id: "chunk.chars", group: "chunk", raw: (p) => p.char_end - p.char_start, kind: "number" },
    { id: "chunk.position", group: "chunk", raw: (p) => p.ord, kind: "number" },
  );
  for (const k of [...chunkKeys].sort()) out.push({ id: `chunk.metadata.${k}`, group: "chunk", raw: (p) => at(p.chunk_metadata, k) });
  out.push({
    id: "space.cluster", group: "space", kind: "category",
    raw: (p) => (p.cluster == null ? null : p.cluster < 0 ? "noise" : `cluster ${p.cluster}`),
  });
  if (stats) {
    out.push(
      { id: "retrieval.outcome", group: "retrieval", kind: "category", raw: (p) => stats.outcome.get(p.chunk_id) ?? "unused" },
      { id: "retrieval.retrieved", group: "retrieval", kind: "number", raw: (p) => stats.retrieved.get(p.chunk_id) ?? 0 },
      { id: "retrieval.relevant", group: "retrieval", kind: "number", raw: (p) => stats.relevant.get(p.chunk_id) ?? 0 },
    );
  }
  return out;
}

/** Every field with at least one value, typed and summarised. */
export function buildFields(points: SpacePoint[], styles: FieldStyle[] | undefined, stats?: RetrievalStats): Field[] {
  const byId = new Map((styles ?? []).map((s) => [s.field, s]));
  const fields: Field[] = [];
  for (const src of sources(points, stats)) {
    const raw = points.map(src.raw);
    const detected = src.kind ?? detect(raw);
    const style = byId.get(src.id);
    const kind = style?.kind ?? detected;
    const values = raw.map((v) => typed(v, kind));
    const present = values.reduce<number>((n, v) => n + (v == null ? 0 : 1), 0);
    if (present === 0) continue;               // a field nobody filled in doesn't exist for this corpus
    const counts = new Map<string, number>();
    let min: number | null = null, max: number | null = null;
    for (const v of values) {
      if (v == null) continue;
      counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      if (typeof v === "number") {
        min = min == null || v < min ? v : min;
        max = max == null || v > max ? v : max;
      }
    }
    const categories = kind === "category"
      ? [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      : [];
    fields.push({
      id: src.id, group: src.group, label: style?.label ?? FIXED_LABEL[src.id] ?? humanize(src.id),
      kind, detected, hidden: style?.hidden ?? false, style, values, present, distinct: counts.size, categories, min, max,
    });
  }
  return fields;
}

// ---------- colour ----------

/** Colours a person can pick for a value: the categorical palette plus two greys. */
export const COLOR_CHOICES = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8", "--ink", "--ink-3"];
// Automatic order. The palette's blue comes last: on this page blue already means "retrieved".
const AUTO_ORDER = ["--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8", "--cat-1"];
export const OTHER_COLOR = "--ink-3";
export const NONE_COLOR = "--none";

/** Sequential ramp for numbers and dates: low values recede into the ground, high ones stand out. One hue: violet.
 *  On black it runs dark to light (2.2:1 to 11.7:1), on white light to dark (--ramp-1 … --ramp-5, per theme). */
const RAMP = ["--ramp-1", "--ramp-2", "--ramp-3", "--ramp-4", "--ramp-5"];

export function resolveColor(token: string): string {
  if (!token.startsWith("--")) return token;
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#888";
}

export interface CategoryColor { value: string; token: string; count: number; auto: boolean }

/**
 * Colour per category value: the person's choice first; then the most common values, in a fixed
 * order, take the remaining palette colours; the rest share "other". Assigned from all points, so a
 * filter never repaints the values that remain.
 */
export function categoryColors(field: Field, defaults: Record<string, string> = {}): { list: CategoryColor[]; other: number } {
  const chosen = { ...defaults, ...(field.style?.colors ?? {}) };
  const taken = new Set(Object.values(chosen));
  const used = new Set<string>();
  const list: CategoryColor[] = [];
  let other = 0;
  field.categories.forEach((c, rank) => {
    if (chosen[c.value]) {
      list.push({ value: c.value, token: chosen[c.value], count: c.count, auto: !field.style?.colors?.[c.value] });
      return;
    }
    // the colour of its rank, so choosing a colour for one value never repaints the others;
    // only when someone took that colour does this value move to the next free one
    const own = AUTO_ORDER[rank];
    const token = own && !taken.has(own) && !used.has(own) ? own : AUTO_ORDER.find((t) => !taken.has(t) && !used.has(t) && AUTO_ORDER.indexOf(t) >= field.categories.length);
    if (token) {
      used.add(token);
      list.push({ value: c.value, token, count: c.count, auto: true });
    } else other += c.count;
  });
  return { list, other };
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rampColor(ramp: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(ramp[i]), b = hexToRgb(ramp[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

/**
 * How a field is coloured. Built once from the main side's field (plus the other side's, when two
 * versions are shown), so the same value gets the same colour in both panes.
 */
export interface Scale {
  kind: FieldKind;
  categories: CategoryColor[];   // category: the coloured values, most common first
  other: number;                 // points whose value shares the "other" colour
  map: Map<string, string>;      // value -> resolved colour
  min: number;
  max: number;
}

export function makeScale(field: Field | undefined, more: (Field | undefined)[] = []): Scale | undefined {
  if (!field) return undefined;
  const all = [field, ...more.filter((f): f is Field => f != null && f.id === field.id)];
  if (field.kind === "category") {
    // count values over every side, so a value only the other version has still gets a colour
    const counts = new Map<string, number>();
    for (const f of all) for (const c of f.categories) counts.set(c.value, (counts.get(c.value) ?? 0) + c.count);
    const merged: Field = {
      ...field,
      categories: [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    };
    const { list, other } = categoryColors(merged, field.id === "retrieval.outcome" ? OUTCOME_COLORS : {});
    return { kind: field.kind, categories: list, other, map: new Map(list.map((c) => [c.value, resolveColor(c.token)])), min: 0, max: 0 };
  }
  const mins = all.map((f) => f.min).filter((v): v is number => v != null);
  const maxs = all.map((f) => f.max).filter((v): v is number => v != null);
  return { kind: field.kind, categories: [], other: 0, map: new Map(), min: Math.min(...mins), max: Math.max(...maxs) };
}

/** A colour per point (resolved CSS colours), for one side's copy of the field. */
export function applyScale(scale: Scale | undefined, field: Field | undefined, n: number): string[] {
  const plain = resolveColor("--ink-2");
  if (!scale || !field) return new Array(n).fill(plain);
  const none = resolveColor(NONE_COLOR);
  if (scale.kind === "category") {
    const other = resolveColor(OTHER_COLOR);
    return field.values.map((v) => (v == null ? none : scale.map.get(String(v)) ?? other));
  }
  if (scale.kind === "number" || scale.kind === "date") {
    const ramp = RAMP.map(resolveColor);
    return field.values.map((v) => (typeof v === "number" ? rampColor(ramp, (v - scale.min) / (scale.max - scale.min || 1)) : none));
  }
  return new Array(n).fill(plain);
}

export function formatFieldValue(v: Value, kind: FieldKind): string {
  if (v == null) return "—";
  if (kind === "date" && typeof v === "number") return new Date(v).toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2);
  return v;
}

// ---------- filters ----------

export type Filter = { kind: "in"; values: string[] } | { kind: "range"; min: number | null; max: number | null };

export function passes(v: Value, f: Filter): boolean {
  if (f.kind === "in") return v != null && f.values.includes(String(v));
  if (typeof v !== "number") return false;
  return (f.min == null || v >= f.min) && (f.max == null || v <= f.max);
}
