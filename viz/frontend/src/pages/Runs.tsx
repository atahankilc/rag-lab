import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useRuns } from "../api/hooks";
import type { Run, RunStatus } from "../api/types";
import { Centered, ErrorNote, Loading } from "../components/Loading";
import { Readout } from "../components/Readout";
import { Segmented } from "../components/Segmented";
import { flatten, showValue } from "../lib/config";
import { clockTime, formatDuration, formatUsd, shortDate } from "../lib/format";
import { useMedia } from "../lib/useMedia";
import { LOCKED_HINT, useAuth } from "../state/auth";
import { QueueRunForm } from "./QueueRunForm";
import { RunInspector } from "./RunInspector";

type StatusFilter = "all" | RunStatus;

export const STATUS_TEXT: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

/** queued = ring, running = spinning blue arc, done = filled ink, failed = amber × */
export function RunStatusMark({ status }: { status: RunStatus }) {
  if (status === "running") return <span className="run-spin" aria-hidden="true" />;
  if (status === "failed") return <i className="mark lost" aria-hidden="true" />;
  if (status === "queued") return <i className="mark new" aria-hidden="true" />;
  return <i className="mark held" aria-hidden="true" />;
}

/** Overrides in words: "rerank.top_n = 3 · hyde left out · order hyde → dense → generate". */
export function overridesSummary(o: Run["overrides"]): string {
  const { step_order, ...rest } = o;
  const parts = flatten(rest).map(([p, v]) => {
    const step = p.startsWith("steps.") ? p.slice("steps.".length) : p;
    if (p.startsWith("steps.") && v === null && !step.includes(".")) return `${step} left out`;
    return `${step} = ${showValue(v)}`;
  });
  if (Array.isArray(step_order)) parts.push(`order ${step_order.map(String).join(" → ")}`);
  return parts.length ? parts.join(" · ") : "no overrides";
}

export function Runs() {
  const runs = useRuns();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [versions, setVersions] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState(false);
  const { canWrite } = useAuth();
  const md = useMedia("(min-width: 901px)");

  const selectedId = params.get("run") ? Number(params.get("run")) : null;
  const select = (id: number | null) => {
    setQueueing(false);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id == null) next.delete("run");
        else next.set("run", String(id));
        return next;
      },
      { replace: true },
    );
  };

  const all = useMemo(() => runs.data ?? [], [runs.data]);
  const counts = { queued: 0, running: 0, done: 0, failed: 0 } as Record<RunStatus, number>;
  for (const r of all) counts[r.status] += 1;
  const slugs = [...new Map(all.map((r) => [r.slug, r.experiment_id])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s);
  const visible = all.filter(
    (r) => (status === "all" || r.status === status) && (versions.size === 0 || versions.has(r.slug)),
  );
  const spent = all.reduce((sum, r) => sum + Number(r.total_cost_usd ?? 0), 0);
  const selected = all.find((r) => r.id === selectedId);

  if (runs.error)
    return (
      <Centered>
        <ErrorNote error={runs.error} />
      </Centered>
    );
  if (runs.isLoading)
    return (
      <Centered>
        <Loading label="Loading runs" />
      </Centered>
    );

  const cols = md ? "52px minmax(200px, 1fr) 150px 110px 84px 76px 76px" : "40px minmax(0, 1fr) 84px";
  const toggleVersion = (s: string) =>
    setVersions((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div className="page-full">
      <div className="page-col">
        <header className="page-head">
          <div className="page-head-row">
            <div>
              <div className="runs-title">
                <h1 className="page-title">Runs</h1>
                <button
                  type="button"
                  className="pill"
                  aria-pressed={queueing}
                  disabled={!canWrite}
                  title={canWrite ? undefined : LOCKED_HINT}
                  onClick={() => {
                    select(null);
                    setQueueing(true);
                  }}
                >
                  <Plus /> Queue run
                </button>
              </div>
              <p className="lede">
                Every evaluation of every version. A queued run waits for a backend to claim it, and there is no backend
                yet, so new runs stay queued.
              </p>
            </div>
            <div className="page-readouts">
              <Readout label="Runs" value={String(all.length)} />
              <Readout label="Running" value={String(counts.running)} />
              <Readout label="Queued" value={String(counts.queued)} />
              <Readout label="Failed" value={String(counts.failed)} />
              <Readout label="Spent" value={formatUsd(spent)} />
            </div>
          </div>

          <div className="filter-row">
            <Segmented<StatusFilter>
              ariaLabel="Filter by status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All", count: all.length },
                { value: "running", label: "Running", count: counts.running },
                { value: "queued", label: "Queued", count: counts.queued },
                { value: "done", label: "Done", count: counts.done },
                { value: "failed", label: "Failed", count: counts.failed },
              ]}
            />
            <span className="divider" aria-hidden="true" />
            {slugs.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={versions.has(s)}
                onClick={() => toggleVersion(s)}
              >
                {s} <span className="count">{all.filter((r) => r.slug === s).length}</span>
              </button>
            ))}
          </div>

          <div className="t-row t-head" style={{ ["--cols" as string]: cols }}>
            <span>Run</span>
            <span>Version · overrides</span>
            <span>Status</span>
            {md ? (
              <>
                <span>Started</span>
                <span className="t-num">Duration</span>
                <span className="t-num">Answers</span>
                <span className="t-num">Cost</span>
              </>
            ) : null}
          </div>
        </header>

        <div className="t-table" aria-label="Runs">
          {visible.length === 0 ? <p className="t-empty">No run matches these filters.</p> : null}
          {visible.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`t-row run-row ${r.status}`}
              style={{ ["--cols" as string]: cols }}
              aria-current={r.id === selectedId}
              onClick={() => select(r.id)}
              aria-label={`Run ${r.id}, ${r.slug}, ${STATUS_TEXT[r.status]}`}
            >
              <span className="t-id">#{r.id}</span>
              <span className="t-name">
                <span className="main">
                  <span className="timeline-slug">{r.slug}</span> {r.experiment_name}
                </span>
                <span className="sub run-overrides">{overridesSummary(r.overrides)}</span>
              </span>
              <span className="run-status">
                <span className="run-status-main">
                  <RunStatusMark status={r.status} /> {STATUS_TEXT[r.status]}
                </span>
                <span className="t-meta">
                  {r.status === "queued"
                    ? "waiting for a backend"
                    : r.status === "failed"
                      ? (r.error?.split(":")[0] ?? "failed")
                      : r.status === "running"
                        ? `${r.results} / ${r.questions} answered`
                        : `${r.events} events`}
                </span>
              </span>
              {md ? (
                <>
                  <span>
                    <span className="t-val">{r.started_at ? shortDate(r.started_at) : "—"}</span>
                    <span className="t-meta">
                      {r.started_at ? clockTime(r.started_at) : `queued ${clockTime(r.queued_at)}`}
                    </span>
                  </span>
                  <span className="t-num">
                    <span className="t-val">{formatDuration(r.duration_ms)}</span>
                  </span>
                  <span className="t-num">
                    <span className="t-val">
                      {r.results} / {r.questions}
                    </span>
                  </span>
                  <span className="t-num">
                    <span className="t-val">
                      {r.total_cost_usd != null ? formatUsd(Number(r.total_cost_usd)) : "—"}
                    </span>
                  </span>
                </>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {queueing ? (
        <QueueRunForm onClose={() => setQueueing(false)} onQueued={(id) => select(id)} />
      ) : selected ? (
        <RunInspector run={selected} onClose={() => select(null)} />
      ) : null}
    </div>
  );
}
