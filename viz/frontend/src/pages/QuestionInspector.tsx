import { Fragment, useMemo, useState } from "react";
import { useEvalQuestion, useMetricDefs, useQuestionResults, useRetrievalHits } from "../api/hooks";
import type { Evidence, HitStage, QuestionResult, RetrievalHit, Verdict } from "../api/types";
import { Inspector, InspectorSection } from "../components/Inspector";
import { Readout } from "../components/Readout";
import { Segmented } from "../components/Segmented";
import { defFor, direction, formatDelta, formatUsd, formatValue } from "../lib/format";
import { finalStage, hitStages, stepRank } from "../lib/steps";
import { useVersion } from "../state/version";
import { VerdictMark } from "./Questions";

function found(ev: Evidence, context: RetrievalHit[]): boolean {
  return context.some(
    (h) => h.document_id === ev.document_id && h.char_start < ev.char_end && ev.char_start < h.char_end,
  );
}

export function QuestionInspector({
  r,
  onClose,
  verdict,
}: {
  r: QuestionResult;
  onClose: () => void;
  verdict: Verdict | null;
}) {
  const { reference, refMode, experiments } = useVersion();
  const stepIds = experiments.find((e) => e.id === r.experiment_id)?.step_ids ?? [];
  const defs = useMetricDefs();
  const hits = useRetrievalHits(r.run_id, r.question_id);
  const question = useEvalQuestion(r.question_id);
  const refResults = useQuestionResults(reference?.id);
  const refRow = refResults.data?.find((x) => x.question_id === r.question_id);
  const refHits = useRetrievalHits(refRow?.run_id, refRow ? r.question_id : undefined);

  // the steps that produced ranked lists, in this version's order; the last one is what the generator saw
  const stages = useMemo(() => hitStages(hits.data ?? [], stepIds), [hits.data, stepIds]);
  const final = finalStage(hits.data ?? [], stepIds);
  const [stageChoice, setStageChoice] = useState<HitStage | null>(null);
  const stage = stageChoice && stages.includes(stageChoice) ? stageChoice : final;
  const [flash, setFlash] = useState<number | null>(null);

  const context = (hits.data ?? []).filter((h) => h.stage === final);
  const shown = (hits.data ?? []).filter((h) => h.stage === stage);
  const citedBy = new Map(r.citations.map((c) => [c.chunk_id, c.marker]));
  const primary = defFor(r.primary_metric, defs.data);
  const refMetrics = refMode === "parent" ? r.parent_metrics : r.baseline_metrics;
  const refScore = refMode === "parent" ? r.parent_score : r.baseline_score;
  const d = r.score != null && refScore != null ? r.score - refScore : null;

  const jumpTo = (marker: string) => {
    const c = r.citations.find((x) => x.marker === marker);
    if (!c) return;
    setStageChoice(final ?? null);
    setFlash(c.chunk_id);
    requestAnimationFrame(() =>
      document.getElementById(`ctx-${c.chunk_id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
    window.setTimeout(() => setFlash(null), 1600);
  };

  return (
    <Inspector
      open
      wide
      onClose={onClose}
      label={`Question ${r.external_id}`}
      layer={`${r.external_id} · ${r.qtype.replace(/_/g, " ")}`}
      layerMark={<VerdictMark v={reference ? verdict : null} />}
      what={`Eval question, as answered by ${r.slug}`}
      title={r.question}
      figure={
        <>
          <Readout
            label={primary.label}
            size={34}
            value={formatValue(r.score, primary.format).value}
            delta={d != null ? formatDelta(d, primary.format) : undefined}
            dir={direction(d, true, 0.005)}
          />
          <Readout
            label="Latency"
            size={34}
            value={formatValue(r.latency_total_ms, "ms").value}
            unit={formatValue(r.latency_total_ms, "ms").unit}
          />
          <Readout label="Cost" size={34} value={r.cost_usd != null ? formatUsd(Number(r.cost_usd)) : "—"} />
        </>
      }
    >
      <InspectorSection title="Answer">
        <p className="q-answer">
          <CitedText text={r.answer ?? "No answer."} onCite={jumpTo} />
        </p>
        {r.gold_answer ? (
          <div className="q-gold">
            <span className="label">Gold</span> {r.gold_answer}
          </div>
        ) : null}
        {r.judge_rationale ? (
          <div className="q-judge">
            <span className="label">Judge</span> {r.judge_rationale}
          </div>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Retrieved context" count={shown.length ? `${stage} · top ${shown.length}` : undefined}>
        {stages.length > 1 ? (
          <Segmented<HitStage>
            ariaLabel="Retrieval stage"
            value={stage!}
            onChange={setStageChoice}
            options={stages.map((s) => ({ value: s, label: s === final ? `${s} · final` : s }))}
          />
        ) : null}
        {hits.isLoading ? <p className="muted">Loading…</p> : null}
        <ContextList hits={shown} cited={stage === final ? citedBy : new Map()} flash={flash} />
      </InspectorSection>

      <InspectorSection
        title="Gold evidence"
        count={
          question.data
            ? `${question.data.evidence.filter((e) => found(e, context)).length} / ${question.data.evidence.length} found`
            : undefined
        }
      >
        {question.data?.evidence.length === 0 ? (
          <p className="muted">None: the corpus doesn't answer this question. The right answer is to say so.</p>
        ) : null}
        {question.data?.evidence.map((ev, i) => {
          const ok = found(ev, context);
          return (
            <div key={i} className="q-evidence">
              <span
                className="q-ev-mark"
                title={ok ? "Found in the final context" : "Missed: no retrieved chunk covers it"}
              >
                {ok ? <i className="mark held" /> : <i className="mark lost" />}
              </span>
              <div>
                <div className="q-ev-text">{ev.text}</div>
                <div className="t-meta">
                  {ev.document_title} · chars {ev.char_start}–{ev.char_end}
                  {ok ? "" : " · missed"}
                </div>
              </div>
            </div>
          );
        })}
      </InspectorSection>

      <InspectorSection title="Metrics" count={reference ? `was = ${reference.slug}` : undefined}>
        {Object.entries(r.metrics)
          .map(([k, v]) => [defFor(k, defs.data), v] as const)
          .sort((a, b) => a[0].sort - b[0].sort)
          .map(([def, v]) => {
            const rv = refMetrics?.[def.name];
            const delta = rv != null ? v - rv : null;
            const dir = direction(delta, def.higher_is_better, 0.005);
            return (
              <div key={def.name} className="kv-row">
                <span className="k">{def.label}</span>
                <span className="v">
                  {formatValue(v, def.format).value}
                  {rv != null && dir !== "flat" ? (
                    <span className={`was ${dir}`}>was {formatValue(rv, def.format).value}</span>
                  ) : null}
                </span>
              </div>
            );
          })}
        {Object.keys(r.metrics).length === 0 ? <p className="muted">Not judged yet.</p> : null}
      </InspectorSection>

      <InspectorSection title="Latency by stage">
        {Object.entries(r.latency_ms)
          .filter(([k]) => k !== "total")
          .sort((a, b) => stepRank(stepIds, a[0]) - stepRank(stepIds, b[0]))
          .map(([k, v]) => (
            <div key={k} className="kv-row">
              <span className="k">{k}</span>
              <span className="v">
                {formatValue(v, "ms").value} {formatValue(v, "ms").unit}
              </span>
            </div>
          ))}
      </InspectorSection>

      {reference ? (
        <InspectorSection title={`Side by side · ${r.slug} vs ${reference.slug}`}>
          {!refRow ? (
            <p className="muted">{reference.slug} has no result for this question.</p>
          ) : (
            <div className="q-side">
              <SideColumn
                label={r.slug}
                row={r}
                hits={hits.data ?? []}
                stepIds={stepIds}
                primaryFormat={primary.format}
              />
              <SideColumn
                label={reference.slug}
                row={refRow}
                hits={refHits.data ?? []}
                stepIds={reference.step_ids}
                primaryFormat={primary.format}
              />
            </div>
          )}
        </InspectorSection>
      ) : null}
    </Inspector>
  );
}

/** Answer text with [1]-style markers turned into links to the cited chunk. */
function CitedText({ text, onCite }: { text: string; onCite: (marker: string) => void }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[\d+\]$/.test(p) ? (
          <button key={i} type="button" className="cite" onClick={() => onCite(p)} aria-label={`Show cited chunk ${p}`}>
            {p}
          </button>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function ContextList({
  hits,
  cited,
  flash,
}: {
  hits: RetrievalHit[];
  cited: Map<number, string>;
  flash: number | null;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const scores = hits.map((h) => h.score ?? 0);
  const lo = Math.min(...scores),
    hi = Math.max(...scores);
  return (
    <ol className="ctx-list">
      {hits.map((h) => {
        const frac = hi > lo ? ((h.score ?? lo) - lo) / (hi - lo) : 1;
        const marker = cited.get(h.chunk_id);
        return (
          <li
            key={`${h.stage}-${h.rank}`}
            id={`ctx-${h.chunk_id}`}
            className={`ctx ${flash === h.chunk_id ? "flash" : ""}`}
          >
            <button
              type="button"
              className="ctx-btn"
              onClick={() => setOpen(open === h.rank ? null : h.rank)}
              aria-expanded={open === h.rank}
            >
              <span className="ctx-rank num">{h.rank}</span>
              <span className="ctx-body">
                <span className="ctx-head">
                  <i
                    className={h.relevant ? "mark held" : "mark new"}
                    title={h.relevant ? "Overlaps gold evidence" : "Not relevant"}
                  />
                  <span className="ctx-doc">{h.document_title}</span>
                  {marker ? <span className="cite no-link">{marker}</span> : null}
                  <span className="ctx-score">{h.score != null ? h.score.toFixed(3) : ""}</span>
                </span>
                <span className="bar">
                  <span style={{ width: `${Math.max(4, frac * 100)}%` }} />
                </span>
                <span className={`ctx-text ${open === h.rank ? "open" : ""}`}>{h.text}</span>
                <span className="t-meta">
                  {h.source} · chunk {h.chunk_ord} · {h.token_count} tokens
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SideColumn({
  label,
  row,
  hits,
  stepIds,
  primaryFormat,
}: {
  label: string;
  row: QuestionResult;
  hits: RetrievalHit[];
  stepIds: string[];
  primaryFormat: string;
}) {
  const final = finalStage(hits, stepIds);
  const context = hits.filter((h) => h.stage === final);
  return (
    <div className="q-side-col">
      <div className="section-head">{label}</div>
      <div className="num num-20">{formatValue(row.score, primaryFormat).value}</div>
      <p className="q-side-answer">{row.answer}</p>
      <ol className="q-side-ctx">
        {context.map((h) => (
          <li key={h.rank} title={h.text}>
            <i className={h.relevant ? "mark held" : "mark new"} />
            <span className="ctx-doc">{h.document_title}</span>
          </li>
        ))}
      </ol>
      <div className="t-meta">{final ? `${final} · top ${context.length}` : ""}</div>
    </div>
  );
}
