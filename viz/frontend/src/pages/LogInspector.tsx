import { Link } from "react-router";
import { useLogEvent } from "../api/hooks";
import type { LogEvent } from "../api/types";
import { Inspector, InspectorSection } from "../components/Inspector";
import { showValue } from "../lib/config";
import { clockSeconds, shortDate } from "../lib/format";
import { ACTOR_LABEL, changes, describe } from "./logText";

const ACTOR_TEXT: Record<string, string> = {
  me: "You, through the UI (or an API call with the write role).",
  system: "Automatic: a trigger or a backend spike.",
  model: "A model, for example the judge.",
};

/** One log event: who, when, what changed (before → after), and its raw data. */
export function LogInspector({ id, loaded, slugOf, onClose }: {
  id: number; loaded: LogEvent | undefined; slugOf: (id: number) => string | undefined; onClose: () => void;
}) {
  const fetched = useLogEvent(loaded ? null : id);   // only when opened from a link to an older event
  const e = loaded ?? fetched.data ?? undefined;

  if (!e) {
    return (
      <Inspector open onClose={onClose} label="Log event" layer={`Event #${id}`} title={fetched.isLoading ? "Loading…" : "Not found"}>
        {fetched.isError ? <p className="run-error">{(fetched.error as Error).message}</p> : null}
      </Inspector>
    );
  }

  const desc = describe(e, slugOf);
  const diff = changes(e);
  const isUpdate = e.before != null;
  const markCls = desc.mark === "lost" ? "mark lost" : desc.mark === "weak" ? "mark weak" : desc.mark === "new" ? "mark new" : "mark held";

  return (
    <Inspector
      open
      onClose={onClose}
      label={`Log event ${e.id}`}
      layer={e.action}
      layerMark={<i className={markCls} />}
      what={`${ACTOR_LABEL[e.actor] ?? e.actor} · ${shortDate(e.ts)} ${clockSeconds(e.ts)} · event #${e.id}`}
      title={desc.text}
    >
      {e.note ? (
        <InspectorSection title="Note">
          <p className="log-insp-note">{e.note}</p>
        </InspectorSection>
      ) : null}

      <InspectorSection title={isUpdate ? "What changed" : "Recorded values"} count={diff.length || undefined}>
        {diff.length === 0 ? <p className="muted">No values recorded.</p> : diff.map((c) => (
          <div key={c.path} className={`kv-row ${isUpdate ? "changed" : ""}`}>
            <span className="k">{c.path}</span>
            <span className="v">
              {showValue(c.after)}
              {isUpdate ? <span className="was">was {showValue(c.before)}</span> : null}
            </span>
          </div>
        ))}
      </InspectorSection>

      <InspectorSection title="Target">
        <div className="kv-row"><span className="k">type</span><span className="v">{e.target_type ?? "—"}</span></div>
        <div className="kv-row"><span className="k">id</span><span className="v">{e.target_id ?? "—"}</span></div>
        <div className="kv-row">
          <span className="k">version</span>
          <span className="v">
            {e.slug ? <Link to={`/?v=${e.slug}`} className="log-link">{e.slug} in Pipeline →</Link>
              : e.experiment_id ? `${slugOf(e.experiment_id) ?? `#${e.experiment_id}`} (no longer exists)` : "—"}
          </span>
        </div>
        {e.target_type === "run" && e.target_id ? (
          <div className="kv-row"><span className="k">run</span><span className="v"><Link to={`/runs?run=${e.target_id}`} className="log-link">Run #{e.target_id} →</Link></span></div>
        ) : null}
        {e.target_type === "provider" && e.target_id ? (
          <div className="kv-row"><span className="k">provider</span><span className="v"><Link to={`/providers?provider=${e.target_id}`} className="log-link">{e.target_id} →</Link></span></div>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Actor">
        <p className="prov-fine">{ACTOR_TEXT[e.actor] ?? e.actor}</p>
      </InspectorSection>

      <InspectorSection title="Raw">
        <pre className="qf-json">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
      </InspectorSection>
    </Inspector>
  );
}
