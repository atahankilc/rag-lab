import { useEffect, useState } from "react";
import { useConfigDiff, useQuestionResults } from "../api/hooks";
import type { Experiment } from "../api/types";
import { showValue } from "../lib/config";
import { formatValue, shortDate } from "../lib/format";
import { useVersion } from "../state/version";
import { Segmented } from "./Segmented";

/** Bottom-right: the versions as checkpoints on a rail. Scrubbing moves the whole app. */
export function Timeline() {
  const { experiments, current, index, reference, refMode, setRefMode, setSlug, step, baseline } = useVersion();
  const [hover, setHover] = useState<Experiment | null>(null);

  // ← → move through versions from anywhere, unless typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=slider]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const results = useQuestionResults(current?.id);
  const key = refMode === "parent" ? "verdict_parent" : "verdict_baseline";
  const counts = { better: 0, worse: 0, unchanged: 0 };
  for (const r of results.data ?? []) {
    const v = r[key];
    if (v) counts[v] += 1;
  }

  if (!current) return null;
  const n = experiments.length;
  const labelEvery = n <= 12 ? 1 : Math.ceil(n / 10);

  return (
    <section className="timeline" aria-label="Version timeline">
      {hover ? <VersionCard e={hover} isBaseline={hover.id === baseline?.id} /> : null}
      <div className="timeline-head">
        <div className="timeline-title-block">
          <span className="section-head">
            Version
            <span className="count">
              {index + 1} / {n}
            </span>
          </span>
          <span className="timeline-title">
            <span className="timeline-slug">{current.slug}</span> {current.name}
          </span>
        </div>
        <Segmented
          ariaLabel="Compare against"
          label="vs"
          value={refMode}
          onChange={setRefMode}
          options={[
            { value: "parent", label: "Parent" },
            { value: "baseline", label: "Baseline", disabled: !baseline },
          ]}
        />
      </div>

      <div className="timeline-rail" role="radiogroup" aria-label="Versions">
        <div className="rail-line" />
        {experiments.map((e, i) => {
          const left = n === 1 ? 50 : 4 + (i / (n - 1)) * 92;
          const state = e.id === current.id ? "active" : e.latest_run_id ? "built" : "future";
          return (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={e.id === current.id}
              aria-label={`${e.slug} ${e.name}${e.is_baseline ? ", baseline" : ""}`}
              className={`rail-node ${state}`}
              style={{ left: `${left}%` }}
              onClick={() => setSlug(e.slug)}
              onMouseEnter={() => setHover(e)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(e)}
              onBlur={() => setHover(null)}
              tabIndex={e.id === current.id ? 0 : -1}
            >
              <span className="rail-dot" />
              {i % labelEvery === 0 || e.id === current.id ? <span className="axis rail-label">{e.slug}</span> : null}
              {e.is_baseline ? <span className="rail-base">base</span> : null}
            </button>
          );
        })}
      </div>

      <div className="timeline-counts" aria-live="polite">
        {reference ? (
          <>
            <span>
              <i className="mark rise" /> {counts.better} better
            </span>
            <span>
              <i className="mark fall" /> {counts.worse} worse
            </span>
            <span>
              <i className="mark held" /> {counts.unchanged} same
            </span>
            <span className="muted">vs {reference.slug}</span>
          </>
        ) : (
          <span className="muted">
            {refMode === "parent" ? "First version: nothing to compare with yet" : "This is the baseline"}
          </span>
        )}
      </div>
    </section>
  );
}

function VersionCard({ e, isBaseline }: { e: Experiment; isBaseline: boolean }) {
  const diff = useConfigDiff(e.parent_id ?? undefined, e.id);
  const correctness = e.metrics.correctness;
  return (
    <div className="hover-card glass version-card" role="tooltip">
      <div className="hc-title">
        <span className="timeline-slug">{e.slug}</span> {e.name}
      </div>
      {e.note ? <p className="hc-text">{e.note}</p> : null}
      {e.parent_id ? (
        <ul className="hc-diff">
          {(diff.data ?? []).slice(0, 6).map((d) => (
            <li key={d.path}>
              <span className="hc-path">{d.path}</span>
              <span className="hc-from">{showValue(d.a_value)}</span>
              <span className="muted">→</span>
              <span className="hc-to">{showValue(d.b_value)}</span>
            </li>
          ))}
          {(diff.data?.length ?? 0) > 6 ? <li className="muted">+{diff.data!.length - 6} more</li> : null}
        </ul>
      ) : null}
      <div className="hc-meta">
        {shortDate(e.created_at)}
        {correctness != null ? ` · correctness ${formatValue(correctness, "ratio").value}` : ""}
        {e.parent_slug ? ` · from ${e.parent_slug}` : " · root"}
        {isBaseline ? " · baseline" : ""}
        {e.last_run_status && e.last_run_status !== "done" ? ` · run ${e.last_run_status}` : ""}
      </div>
    </div>
  );
}
