import { BookOpen, Radio } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router";
import { useLatestRun, useRunEvents } from "../api/hooks";
import type { RunProgress } from "../api/types";
import { relativeTime } from "../lib/format";
import { guideFor } from "./guides";

type Panel = "guide" | "run" | null;

/** Bottom-left: Guide and Run; the open panel expands above them. One at a time. */
export function Dock({ showRun = true }: { showRun?: boolean }) {
  const [state, setOpen] = useState<Panel>(null);
  const open = state === "run" && !showRun ? null : state;
  const run = useLatestRun();
  const active = run.data && (run.data.status === "running" || run.data.status === "queued");

  const toggle = (p: Panel) => setOpen(open === p ? null : p);

  return (
    <div className="dock">
      {open ? (
        <div className="dock-panel glass appear" id="dock-panel">
          {open === "guide" ? <GuidePanel /> : <RunPanel run={run.data ?? null} />}
        </div>
      ) : null}
      <div className="dock-pills">
        <button
          type="button"
          className="nav-link"
          aria-pressed={open === "guide"}
          aria-controls="dock-panel"
          onClick={() => toggle("guide")}
        >
          <BookOpen /> Guide
        </button>
        {showRun ? (
          <button
            type="button"
            className="nav-link"
            aria-pressed={open === "run"}
            aria-controls="dock-panel"
            onClick={() => toggle("run")}
          >
            <Radio /> Run
            {active ? <span className="pill-live" aria-label={`run ${run.data!.status}`} /> : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function GuidePanel() {
  const { pathname } = useLocation();
  const guide = guideFor(pathname);
  return (
    <div className="guide">
      <h2 className="section-head">Guide · {guide.title}</h2>
      <ul>
        {guide.entries.map((e) => (
          <li key={e.name}>
            <span className="guide-mark">
              {e.mark.startsWith("text:") ? (
                <span className="guide-glyph">{e.mark.slice(5)}</span>
              ) : e.mark === "loc" ? (
                <span className="loc">local</span>
              ) : (
                <i className={e.mark} />
              )}
            </span>
            <span>
              <b>{e.name}</b> {e.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RunPanel({ run }: { run: RunProgress | null }) {
  const events = useRunEvents(run?.run_id, 12);
  if (!run) return <p className="muted">No runs yet.</p>;
  const done = run.stages.filter((s) => s.state === "done").length;

  return (
    <div className="run-panel">
      <h2 className="section-head">
        Run {run.slug} · {run.status}
      </h2>
      <p className="run-summary">
        <span className="num num-20">{done}</span>
        <span className="muted"> / {run.stages.length} stages done</span>
      </p>
      {run.status === "queued" ? <p className="lede">Queued. Nothing picks runs up until a backend exists.</p> : null}
      <ul className="run-stages">
        {run.stages.map((s) => {
          const frac = s.state === "done" ? 1 : s.total ? (s.done ?? 0) / s.total : 0;
          return (
            <li key={s.stage} className={`run-stage ${s.state}`}>
              <span className="run-stage-name">{s.label ?? s.stage}</span>
              <span className="bar thick">
                <span style={{ width: `${frac * 100}%` }} />
              </span>
              <span className="run-stage-count muted">
                {s.state === "done"
                  ? "done"
                  : s.total
                    ? `${s.done ?? 0}/${s.total}`
                    : s.state === "pending"
                      ? ""
                      : s.state}
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="run-events">
        {(events.data ?? []).map((e, i) => (
          <li key={e.id} style={{ opacity: Math.max(0.35, 1 - i * 0.07) }} className={e.level}>
            <span className="run-event-msg">{e.message}</span>
            <span className="muted">{relativeTime(e.ts)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
