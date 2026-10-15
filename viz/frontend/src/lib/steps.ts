import type { RetrievalHit } from "../api/types";

/** Position of a step id in the version's declared order; unknown ids go last, in name order. */
export function stepRank(stepIds: string[], id: string): number {
  const i = stepIds.indexOf(id);
  return i === -1 ? 10_000 : i;
}

/** The steps that produced ranked lists for a question, in pipeline order. */
export function hitStages(hits: RetrievalHit[], stepIds: string[]): string[] {
  return [...new Set(hits.map((h) => h.stage))].sort((a, b) => stepRank(stepIds, a) - stepRank(stepIds, b) || a.localeCompare(b));
}

/** The final context is the output of the last step (in pipeline order) that produced a list. */
export function finalStage(hits: RetrievalHit[], stepIds: string[]): string | undefined {
  const stages = hitStages(hits, stepIds);
  return stages[stages.length - 1];
}
