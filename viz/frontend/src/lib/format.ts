import type { MetricDef } from "../api/types";

const MINUS = "−";

/** A metric_def for any name, including names the database doesn't know yet. */
export function defFor(name: string, defs: MetricDef[] | undefined): MetricDef {
  const known = defs?.find((d) => d.name === name);
  if (known) return known;
  const format = name.endsWith("_ms") ? "ms" : name.endsWith("_usd") ? "usd" : name.endsWith("_s") ? "s" : "auto";
  return {
    name,
    label: name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    grp: format === "auto" ? "generation" : "ops",
    unit: null,
    higher_is_better: !(format === "ms" || format === "usd" || format === "s"),
    format,
    is_primary: false,
    sort: 1000,
    description: null,
  };
}

export interface Formatted {
  value: string;
  unit: string;
}

export function formatValue(v: number | null | undefined, format: string, digits?: number): Formatted {
  if (v == null || Number.isNaN(v)) return { value: "—", unit: "" };
  switch (format) {
    case "ratio":
      return { value: v.toFixed(digits ?? 2), unit: "" };
    case "pct":
      return { value: (v * 100).toFixed(digits ?? 0), unit: "%" };
    case "ms":
      return v >= 10_000
        ? { value: (v / 1000).toFixed(1), unit: "s" }
        : { value: Math.round(v).toLocaleString("en-US"), unit: "ms" };
    case "s":
      return { value: v.toFixed(1), unit: "s" };
    case "mb":
      return { value: v.toFixed(1), unit: "MB" };
    case "usd":
      return { value: formatUsd(v), unit: "" };
    case "int":
      return { value: Math.round(v).toLocaleString("en-US"), unit: "" };
    default:
      return Math.abs(v) <= 1
        ? { value: v.toFixed(digits ?? 2), unit: "" }
        : { value: Math.round(v).toLocaleString("en-US"), unit: "" };
  }
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  if (Math.abs(v) >= 0.01) return `$${v.toFixed(3)}`;
  // two significant digits without scientific notation: 5e-7 -> $0.0000005
  const digits = Math.min(12, Math.ceil(-Math.log10(Math.abs(v))) + 1);
  return `$${v.toFixed(digits).replace(/0+$/, "")}`;
}

export function formatInt(v: number | null | undefined): string {
  return v == null ? "—" : Math.round(v).toLocaleString("en-US");
}

/** "+0.12" / "−3" / "±0"; same units as formatValue. */
export function formatDelta(d: number | null | undefined, format: string, digits?: number): string {
  if (d == null || Number.isNaN(d)) return "";
  const f = formatValue(Math.abs(d), format, digits);
  if (Number(f.value.replace(/[^0-9.]/g, "")) === 0) return `±${f.value}`;
  return `${d > 0 ? "+" : MINUS}${f.value}${f.unit && f.unit !== "%" ? ` ${f.unit}` : f.unit}`;
}

export type Direction = "rise" | "fall" | "flat";

/** Better or worse, given which way is good. Tiny changes count as flat. */
export function direction(d: number | null | undefined, higherIsBetter: boolean, epsilon = 1e-9): Direction {
  if (d == null || Math.abs(d) <= epsilon) return "flat";
  return d > 0 === higherIsBetter ? "rise" : "fall";
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** 83315 -> "1m 23s", 1494284 -> "24m 54s", 7380000 -> "2h 3m". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function clockSeconds(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
