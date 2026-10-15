import { useRunEvents, useRunMetrics, useRunProgress } from "../api/hooks";
import type { Run, RunStage } from "../api/types";
import { Inspector, InspectorSection } from "../components/Inspector";
import { Readout } from "../components/Readout";
import { flatten, showValue } from "../lib/config";
import { clockSeconds, clockTime, formatDuration, formatUsd, formatValue, shortDate } from "../lib/format";
import { RunStatusMark, STATUS_TEXT } from "./Runs";

function headline(run: Run, stages: RunStage[] | undefined): string {
  if (run.status === "queued") return "Queued, waiting for a backend to claim it";
  if (run.status === "done") return `Done in ${formatDuration(run.duration_ms)}`;
  const active = stages?.find((s) => s.state !== "done" && s.state !== "pending");
  if (run.status === "failed") return `Failed during ${active ? (active.label ?? active.stage) : "the run"}`;
  if (!active) return "Running";
  return `${active.label ?? active.stage}${active.total ? ` · ${active.done ?? 0} of ${active.total}` : ""}`;
}

/** One run: stage progress, its event log, cost, metrics and where it ran. */
export function RunInspector({ run, onClose }: { run: Run; onClose: () => void }) {
  const progress = useRunProgress(run.id, run.status);
  const events = useRunEvents(run.id, 200);
  const metrics = useRunMetrics(run.status === "done" ? run.id : undefined);
  const stages = progress.data?.stages;
  const done = stages?.filter((s) => s.state === "done").length ?? 0;

  return (
    <Inspector
      open
      onClose={onClose}
      label={`Run ${run.id}`}
      layer={`Run #${run.id} · ${STATUS_TEXT[run.status]}`}
      layerMark={<RunStatusMark status={run.status} />}
      what={`${run.slug} · ${run.experiment_name} · queued ${shortDate(run.queued_at)} ${clockTime(run.queued_at)}`}
      title={headline(run, stages)}
      figure={
        <>
          <Readout label="Duration" size={34} value={formatDuration(run.duration_ms)} />
          <Readout label="Answers" size={34} value={`${run.results}`} unit={`/ ${run.questions}`} />
          <Readout
            label="Cost"
            size={34}
            value={run.total_cost_usd != null ? formatUsd(Number(run.total_cost_usd)) : "—"}
          />
        </>
      }
    >
      {run.status === "queued" ? (
        <p className="lede run-note">
          Nothing will pick this run up yet. A backend spike claims queued runs and writes its results back (see{" "}
          <code>viz/docs/backend-contract.md</code>, coming last). Until then it stays queued.
        </p>
      ) : null}
      {run.error ? (
        <p className="run-error" role="alert">
          {run.error}
        </p>
      ) : null}

      <InspectorSection title="Stages" count={stages ? `${done} / ${stages.length} done` : undefined}>
        <ul className="run-stages big">
          {(stages ?? []).map((s) => {
            const frac = s.state === "done" ? 1 : s.total ? (s.done ?? 0) / s.total : 0;
            return (
              <li key={s.stage} className={`run-stage ${s.state}`}>
                <span className="run-stage-name">{s.label ?? s.stage}</span>
                <span className={`bar thick ${s.state === "failed" ? "limit" : ""}`}>
                  <span style={{ width: `${Math.max(frac * 100, s.state === "failed" ? 2 : 0)}%` }} />
                </span>
                <span className="run-stage-count">
                  {s.state === "done"
                    ? "done"
                    : s.total
                      ? `${s.done ?? 0}/${s.total}`
                      : s.state === "pending"
                        ? "—"
                        : s.state}
                </span>
              </li>
            );
          })}
        </ul>
      </InspectorSection>

      <InspectorSection title="Overrides">
        {flatten(run.overrides).length === 0 ? (
          <p className="muted">None: the version's config as is.</p>
        ) : (
          flatten(run.overrides).map(([p, v]) => (
            <div key={p} className="kv-row changed">
              <span className="k">{p}</span>
              <span className="v">{showValue(v)}</span>
            </div>
          ))
        )}
      </InspectorSection>

      {run.status === "done" ? (
        <InspectorSection title="Metrics">
          {(metrics.data ?? [])
            .filter((m) => m.scope === "all")
            .map((m) => {
              const f = formatValue(m.value, m.format);
              return (
                <div key={m.name} className="kv-row">
                  <span className="k">{m.label}</span>
                  <span className="v">
                    {f.value}
                    {f.unit ? ` ${f.unit}` : ""}
                  </span>
                </div>
              );
            })}
        </InspectorSection>
      ) : null}

      <InspectorSection title="Cost by stage">
        {Object.keys(run.stage_cost).length === 0 ? (
          <p className="muted">No spend recorded yet.</p>
        ) : (
          Object.entries(run.stage_cost)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k} className="kv-row">
                <span className="k">{k}</span>
                <span className="v">{formatUsd(Number(v))}</span>
              </div>
            ))
        )}
      </InspectorSection>

      <InspectorSection title="Events" count={events.data ? events.data.length : undefined}>
        {events.data?.length === 0 ? <p className="muted">No events yet.</p> : null}
        <ol className="run-log">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className={`run-log-row ${e.level}`}>
              <span className="run-log-time">{clockSeconds(e.ts)}</span>
              <span className="run-log-stage">{e.stage ?? ""}</span>
              <span className="run-log-msg">{e.message}</span>
            </li>
          ))}
        </ol>
      </InspectorSection>

      <InspectorSection title="Where it ran">
        <div className="kv-row">
          <span className="k">queued</span>
          <span className="v">
            {shortDate(run.queued_at)} {clockSeconds(run.queued_at)}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">started</span>
          <span className="v">
            {run.started_at ? `${shortDate(run.started_at)} ${clockSeconds(run.started_at)}` : "—"}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">finished</span>
          <span className="v">
            {run.finished_at ? `${shortDate(run.finished_at)} ${clockSeconds(run.finished_at)}` : "—"}
          </span>
        </div>
        <div className="kv-row">
          <span className="k">git commit</span>
          <span className="v">{run.git_commit ?? "—"}</span>
        </div>
        <div className="kv-row">
          <span className="k">worker</span>
          <span className="v">{run.worker ?? "—"}</span>
        </div>
        {flatten(run.environment).map(([p, v]) => (
          <div key={p} className="kv-row">
            <span className="k">{p}</span>
            <span className="v">{showValue(v)}</span>
          </div>
        ))}
      </InspectorSection>
    </Inspector>
  );
}
