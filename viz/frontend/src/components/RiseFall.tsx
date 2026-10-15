import type { Experiment, QuestionResult } from "../api/types";
import { formatValue } from "../lib/format";
import { useVersion } from "../state/version";

/** Green/red callouts: the questions that got better or worse vs the reference, and what changed. */
export function RiseFall({ results, reference, changedKeys, limit = 4, onPick }: {
  results: QuestionResult[];
  reference: Experiment | undefined;
  changedKeys: string[];
  limit?: number;
  onPick?: (r: QuestionResult) => void;
}) {
  const { refMode } = useVersion();
  if (!reference) return null;
  const verdict = (r: QuestionResult) => (refMode === "parent" ? r.verdict_parent : r.verdict_baseline);
  const refScore = (r: QuestionResult) => (refMode === "parent" ? r.parent_score : r.baseline_score);
  const delta = (r: QuestionResult) => (refMode === "parent" ? r.delta_parent : r.delta_baseline) ?? 0;

  const better = results.filter((r) => verdict(r) === "better").sort((a, b) => delta(b) - delta(a));
  const worse = results.filter((r) => verdict(r) === "worse").sort((a, b) => delta(a) - delta(b));
  const cause = changedKeys.length ? `changed: ${changedKeys.join(", ")}` : "no config change";
  const metric = results[0]?.primary_metric ?? "score";

  const list = (rows: QuestionResult[]) => (
    <ul className="rf-list">
      {rows.slice(0, limit).map((r) => (
        <li key={r.question_id}>
          <button type="button" className="rf-item" onClick={() => onPick?.(r)} disabled={!onPick}
                  title={r.question}>
            <span className="rf-id">{r.external_id}</span>
            <span className="rf-type">{r.qtype.replace(/_/g, " ")}</span>
            <span className="rf-scores">
              {formatValue(refScore(r), "ratio").value} → {formatValue(r.score, "ratio").value}
            </span>
          </button>
        </li>
      ))}
      {rows.length > limit ? <li className="muted rf-more">+{rows.length - limit} more</li> : null}
    </ul>
  );

  return (
    <div className="risefall-pair" aria-label={`Questions that changed vs ${reference.slug}`}>
      {better.length ? (
        <div className="risefall rise">
          <div className="head">▲ {better.length} improved</div>
          {list(better)}
          <div className="rf-cause">{metric} vs {reference.slug} · {cause}</div>
        </div>
      ) : null}
      {worse.length ? (
        <div className="risefall fall">
          <div className="head">▼ {worse.length} regressed — review</div>
          {list(worse)}
          <div className="rf-cause">{metric} vs {reference.slug} · {cause}</div>
        </div>
      ) : null}
      {!better.length && !worse.length ? (
        <p className="muted rf-none">No question changed by 0.1 or more vs {reference.slug}.</p>
      ) : null}
    </div>
  );
}
