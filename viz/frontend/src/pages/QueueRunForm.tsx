import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useExperimentDetail, useQueueRun } from "../api/hooks";
import type { Json, JsonObject } from "../api/types";
import { Inspector, InspectorSection } from "../components/Inspector";
import { flatten, setPath, showValue } from "../lib/config";
import { LoginHint, useAuth } from "../state/auth";
import { useVersion } from "../state/version";

// Overrides use the "keyed" form the database applies (lab.apply_overrides):
//   {"steps": {"rerank": {"top_n": 8}}}  change one step's setting
//   {"steps": {"bm25": null}}            leave a step out of this run
//   {"step_order": ["hyde", "dense", ...]} run the steps in another order
//   anything else deep-merges into the config

type Field = { path: string; original: Json; text: string; added?: boolean };
type Step = { id: string; kind: string; settings: JsonObject };

/** Turn what was typed back into the original value's type. Returns undefined when it doesn't parse. */
function parse(text: string, original: Json, added?: boolean): Json | undefined {
  if (added || original === null || typeof original === "object") {
    try {
      return JSON.parse(text) as Json;
    } catch {
      return added ? text : undefined; // a new setting may simply be a string
    }
  }
  if (typeof original === "number") {
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) ? n : undefined;
  }
  if (typeof original === "boolean") return text === "true";
  return text;
}

const toText = (v: Json) => (typeof v === "string" ? v : JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readSteps(config: JsonObject): Step[] {
  const list = Array.isArray(config.steps) ? config.steps : [];
  return list.flatMap((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return [];
    const { id, kind, ...settings } = s as JsonObject;
    return typeof id === "string" ? [{ id, kind: String(kind ?? ""), settings: settings as JsonObject }] : [];
  });
}

/** Pick a version, change its steps or settings for this one run, and queue it. */
export function QueueRunForm({ onClose, onQueued }: { onClose: () => void; onQueued: (runId: number) => void }) {
  const { current, experiments } = useVersion();
  const [experimentId, setExperimentId] = useState<number | undefined>(current?.id);
  const detail = useExperimentDetail(experimentId);
  const queue = useQueueRun();
  const { canWrite } = useAuth();
  const [steps, setSteps] = useState<Step[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Field[]>([]);
  const [newPath, setNewPath] = useState("");
  const [newValue, setNewValue] = useState("");
  const [note, setNote] = useState("");

  // the editable settings: every step's settings (by step id) and any other pipeline config.
  // The library (corpus, chunking, embedding) is shared and can't change per run: make a new version for that.
  useEffect(() => {
    if (!detail.data) return;
    const config = detail.data.pipeline_config;
    const s = readSteps(config);
    const { steps: _ignored, ...rest } = config;
    setSteps(s);
    setOrder(s.map((x) => x.id));
    setSkipped(new Set());
    setFields([
      ...s.flatMap((step) =>
        flatten(step.settings).map(([p, v]) => ({ path: `steps.${step.id}.${p}`, original: v, text: toText(v) })),
      ),
      ...flatten(rest as JsonObject).map(([path, v]) => ({ path, original: v, text: toText(v) })),
    ]);
  }, [detail.data]);

  const parsed = fields.map((f) => ({ ...f, value: parse(f.text, f.original, f.added) }));
  const invalid = parsed.filter((f) => f.value === undefined);
  const changed = parsed.filter((f) => f.value !== undefined && (f.added || !same(f.value, f.original)));
  const originalOrder = steps.map((s) => s.id);

  let overrides = changed
    .filter((f) => !skipped.has(f.path.split(".")[1] ?? "") || !f.path.startsWith("steps."))
    .reduce<JsonObject>((acc, f) => setPath(acc, f.path, f.value as Json), {});
  for (const id of skipped) overrides = setPath(overrides, `steps.${id}`, null);
  if (!same(order, originalOrder)) overrides = { ...overrides, step_order: order.filter((id) => !skipped.has(id)) };

  const setText = (path: string, text: string) =>
    setFields((fs) => fs.map((f) => (f.path === path ? { ...f, text } : f)));
  const reset = (path: string) =>
    setFields((fs) => fs.flatMap((f) => (f.path !== path ? [f] : f.added ? [] : [{ ...f, text: toText(f.original) }])));
  const move = (id: string, by: number) =>
    setOrder((o) => {
      const i = o.indexOf(id),
        j = i + by;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const toggleSkip = (id: string) =>
    setSkipped((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addSetting = () => {
    const path = newPath.trim().replace(/^\.+|\.+$/g, "");
    if (!path || fields.some((f) => f.path === path)) return;
    setFields((fs) => [...fs, { path, original: null, text: newValue, added: true }]);
    setNewPath("");
    setNewValue("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!experimentId || invalid.length || !canWrite) return;
    queue.mutate(
      { experiment_id: experimentId, overrides, note: note.trim() || null },
      { onSuccess: (r) => onQueued(r.run_id) },
    );
  };

  const field = (f: Field, label: string) => {
    const p = parsed.find((x) => x.path === f.path)!;
    const isChanged = changed.some((c) => c.path === f.path);
    const id = `q-${f.path}`;
    return (
      <div key={f.path} className={`qf-row ${isChanged ? "changed" : ""} ${p.value === undefined ? "invalid" : ""}`}>
        <label className="k" htmlFor={id}>
          {label}
          {f.added ? <span className="qf-new">new</span> : null}
        </label>
        {typeof f.original === "boolean" && !f.added ? (
          <button
            id={id}
            type="button"
            role="switch"
            className="toggle"
            aria-checked={f.text === "true"}
            onClick={() => setText(f.path, f.text === "true" ? "false" : "true")}
          />
        ) : (
          <input
            id={id}
            className="input"
            value={f.text}
            spellCheck={false}
            inputMode={typeof f.original === "number" ? "decimal" : undefined}
            onChange={(e) => setText(f.path, e.target.value)}
          />
        )}
        {isChanged || f.added ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => reset(f.path)}
            aria-label={f.added ? `Remove ${f.path}` : `Reset ${f.path}`}
          >
            {f.added ? <X /> : <RotateCcw />}
          </button>
        ) : (
          <span />
        )}
        {isChanged && !f.added ? <span className="qf-was">was {showValue(f.original)}</span> : null}
        {p.value === undefined ? (
          <span className="qf-was qf-bad">not a valid {typeof f.original === "number" ? "number" : "JSON value"}</span>
        ) : null}
      </div>
    );
  };

  const otherFields = fields.filter((f) => !f.path.startsWith("steps.") || !order.includes(f.path.split(".")[1]));
  const orderChanged = !same(order, originalOrder);

  return (
    <Inspector
      open
      onClose={onClose}
      label="Queue a run"
      layer="Queue a run"
      layerMark={<i className="mark new" />}
      what="Runs a version's steps, with optional one-off changes for this run only."
      title="New runs stay queued until a backend exists"
    >
      <LoginHint what="queue a run" />
      <form className="queue-form" onSubmit={submit}>
        <fieldset className="plain" disabled={!canWrite}>
          <InspectorSection title="Version">
            <label className="sr-only" htmlFor="q-version">
              Version
            </label>
            <select
              id="q-version"
              className="select"
              value={experimentId ?? ""}
              onChange={(e) => setExperimentId(Number(e.target.value))}
            >
              {experiments.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.slug} · {x.name}
                </option>
              ))}
            </select>
          </InspectorSection>

          <InspectorSection
            title="Steps, in order"
            count={orderChanged ? "reordered" : skipped.size ? `${skipped.size} left out` : undefined}
          >
            {order.length === 0 ? <p className="muted">This version declares no steps.</p> : null}
            {order.map((id, i) => {
              const step = steps.find((s) => s.id === id)!;
              const off = skipped.has(id);
              const movedHere = originalOrder.indexOf(id) !== i;
              return (
                <div key={id} className={`qf-step ${off ? "off" : ""}`}>
                  <div className="qf-step-head">
                    <span className={`qf-step-pos num ${movedHere ? "moved" : ""}`}>{i + 1}</span>
                    <span className="qf-step-name">{id}</span>
                    <span className="qf-step-kind">{step.kind}</span>
                    <span className="qf-step-tools">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => move(id, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${id} up`}
                      >
                        <ArrowUp />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => move(id, 1)}
                        disabled={i === order.length - 1}
                        aria-label={`Move ${id} down`}
                      >
                        <ArrowDown />
                      </button>
                      <button type="button" className="chip qf-skip" aria-pressed={off} onClick={() => toggleSkip(id)}>
                        {off ? "left out" : "leave out"}
                      </button>
                    </span>
                  </div>
                  {off
                    ? null
                    : fields
                        .filter((f) => f.path.startsWith(`steps.${id}.`))
                        .map((f) => field(f, f.path.slice(`steps.${id}.`.length)))}
                </div>
              );
            })}
          </InspectorSection>

          <InspectorSection title="Other settings">
            {otherFields.length === 0 ? <p className="muted">None.</p> : otherFields.map((f) => field(f, f.path))}
            <div className="qf-add">
              <input
                className="input"
                placeholder="steps.rerank.top_n, or a new step's steps.hyde.kind"
                value={newPath}
                spellCheck={false}
                aria-label="New setting path"
                onChange={(e) => setNewPath(e.target.value)}
              />
              <input
                className="input"
                placeholder="value (JSON or text)"
                value={newValue}
                spellCheck={false}
                aria-label="New setting value"
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSetting();
                  }
                }}
              />
              <button type="button" className="pill small" onClick={addSetting} disabled={!newPath.trim()}>
                Add
              </button>
            </div>
          </InspectorSection>

          <InspectorSection title="Overrides sent">
            <pre className="qf-json">{JSON.stringify(overrides, null, 2)}</pre>
          </InspectorSection>

          <InspectorSection title="Note">
            <label className="sr-only" htmlFor="q-note">
              Why this run
            </label>
            <textarea
              id="q-note"
              className="input"
              rows={2}
              placeholder="Why this run (goes into the log)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </InspectorSection>

          <div className="qf-submit">
            <button type="submit" className="pill" disabled={!experimentId || invalid.length > 0 || queue.isPending}>
              {queue.isPending ? "Queueing…" : "Queue run"}
            </button>
            {queue.error ? <span className="run-error">{(queue.error as Error).message}</span> : null}
            {invalid.length ? (
              <span className="run-error">
                Fix {invalid.length} setting{invalid.length > 1 ? "s" : ""} first.
              </span>
            ) : null}
          </div>
        </fieldset>
      </form>
    </Inspector>
  );
}
