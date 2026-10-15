import type { Json, LogEvent } from "../api/types";
import { flatten, showValue } from "../lib/config";
import { formatUsd } from "../lib/format";

export type LogMark = "new" | "held" | "weak" | "lost";

export interface Described {
  text: string;
  /** milestones (a new version, a finished or failed run, a new baseline) are set in bold */
  milestone: boolean;
  mark: LogMark;
}

const str = (v: Json | undefined) => (v == null ? "" : typeof v === "string" ? v : showValue(v));

/** Fields that changed, as "field old → new" pairs, from a before/after pair. */
export function changes(e: LogEvent): { path: string; before: Json; after: Json }[] {
  const before = new Map(flatten(e.before));
  const after = new Map(flatten(e.after));
  const paths = [...new Set([...before.keys(), ...after.keys()])];
  return paths.map((path) => ({ path, before: before.get(path) ?? null, after: after.get(path) ?? null }));
}

/** One plain sentence per event. Unknown actions still read sensibly. `slugOf` names versions by id. */
export function describe(e: LogEvent, slugOf: (id: number) => string | undefined = () => undefined): Described {
  const a = e.after ?? {};
  const v = e.slug ?? (e.experiment_id ? `version ${e.experiment_id}` : "");
  switch (e.action) {
    case "corpus.register":
      return { text: `Registered corpus ${str(a.name)}`, milestone: true, mark: "new" };
    case "chunk_set.create":
      return { text: `Created chunk set ${str(a.name)}`, milestone: false, mark: "new" };
    case "space.create":
      return {
        text: `Created embedding space ${str(a.model)} · ${str(a.dim)} dims · ${str(a.location)}`,
        milestone: false,
        mark: "new",
      };
    case "space.build": {
      const secs = typeof a.build_ms === "number" ? ` in ${(a.build_ms / 1000).toFixed(1)} s` : "";
      return { text: `Built the vector index: ${str(a.vectors)} vectors${secs}`, milestone: false, mark: "held" };
    }
    case "eval_set.create":
      return { text: `Created eval set ${str(a.name)} v${str(a.version)}`, milestone: false, mark: "new" };
    case "experiment.create":
      return {
        text: `Created ${str(a.slug)} ${str(a.name)}${typeof a.parent_id === "number" ? `, from ${slugOf(a.parent_id) ?? `version ${a.parent_id}`}` : " as the first version"}`,
        milestone: true,
        mark: "new",
      };
    case "experiment.note":
      return { text: `Note on ${v}`, milestone: false, mark: "held" };
    case "experiment.update":
      return {
        text: `Changed ${v}: ${changes(e)
          .map((c) => `${c.path} ${str(c.before)} → ${str(c.after)}`)
          .join(", ")}`,
        milestone: false,
        mark: "held",
      };
    case "baseline.pin":
      return { text: `Pinned ${v} as the baseline`, milestone: true, mark: "held" };
    case "baseline.unpin":
      return { text: `Unpinned ${v} as the baseline`, milestone: false, mark: "held" };
    case "run.queue": {
      const o =
        a.overrides && typeof a.overrides === "object" && !Array.isArray(a.overrides) ? flatten(a.overrides) : [];
      return {
        text: `Queued run #${e.target_id} of ${v}${o.length ? ` · ${o.map(([p, x]) => `${p} = ${showValue(x)}`).join(", ")}` : ""}`,
        milestone: false,
        mark: "new",
      };
    }
    case "run.start":
      return { text: `Started run #${e.target_id} of ${v}`, milestone: false, mark: "held" };
    case "run.done":
      return {
        text: `Run #${e.target_id} of ${v} done${typeof a.total_cost_usd === "number" ? ` · ${formatUsd(a.total_cost_usd)}` : ""}`,
        milestone: true,
        mark: "held",
      };
    case "run.fail":
      return { text: `Run #${e.target_id} of ${v} failed`, milestone: true, mark: "lost" };
    case "provider.add":
      return { text: `Added provider ${str(a.name) || e.target_id}`, milestone: false, mark: "new" };
    case "provider.update":
      return {
        text: `Changed provider ${e.target_id}: ${changes(e)
          .map((c) => `${c.path} ${str(c.before) || "—"} → ${str(c.after) || "—"}`)
          .join(", ")}`,
        milestone: false,
        mark: "held",
      };
    case "default_model.update":
      return {
        text: `Changed the default model for ${e.target_id}: ${changes(e)
          .map((c) => `${str(c.before)} → ${str(c.after)}`)
          .join(", ")}`,
        milestone: false,
        mark: "held",
      };
    case "field.style": {
      const [corpus, field] = (e.target_id ?? "").split(/\/(.*)/);
      // a new row records every setting; name only the ones that differ from the defaults
      const what = changes(e)
        .filter((c) => c.path !== "corpus_name" && c.path !== "field")
        .filter(
          (c) =>
            JSON.stringify(c.before) !== JSON.stringify(c.after) &&
            !(c.before == null && (c.after == null || c.after === false)),
        )
        .map((c) => `${c.path} ${str(c.before) || "—"} → ${str(c.after) || "—"}`)
        .join(", ");
      return {
        text: `Changed how ${field} shows on the Space page (${corpus})${what ? `: ${what}` : ""}`,
        milestone: false,
        mark: "held",
      };
    }
    case "field.reset": {
      const [corpus, field] = (e.target_id ?? "").split(/\/(.*)/);
      return {
        text: `Reset ${field} to its detected settings on the Space page (${corpus})`,
        milestone: false,
        mark: "held",
      };
    }
    case "judge.flag":
      return { text: `The judge flagged answers in ${v}`, milestone: false, mark: "weak" };
    default:
      return {
        text: `${e.action}${e.target_id ? ` · ${e.target_type ?? ""} ${e.target_id}` : ""}${v ? ` · ${v}` : ""}`,
        milestone: false,
        mark: "held",
      };
  }
}

export const ACTOR_LABEL: Record<string, string> = { me: "Me", system: "System", model: "Model" };

export const KIND_LABEL: Record<string, string> = {
  corpus: "corpus",
  chunk_set: "chunking",
  space: "embeddings",
  eval_set: "eval set",
  experiment: "versions",
  baseline: "baseline",
  run: "runs",
  provider: "providers",
  default_model: "default models",
  judge: "judge",
};
