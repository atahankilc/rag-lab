import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEvalQuestion, useMetricDefs, useQuestionResults, useRetrievalHits } from "../api/hooks";
import type { Evidence, Experiment, HitStage, QuestionResult, RetrievalHit, Verdict } from "../api/types";
import { Markdown } from "../components/Markdown";
import { Segmented } from "../components/Segmented";
import { defFor, direction, formatDelta, formatUsd, formatValue } from "../lib/format";
import { finalStage, hitStages, stepRank } from "../lib/steps";
import { useTween } from "../lib/useTween";
import { useVersion } from "../state/version";
import { VerdictMark } from "./Questions";

function found(ev: Evidence, context: RetrievalHit[]): boolean {
  return context.some(
    (h) => h.document_id === ev.document_id && h.char_start < ev.char_end && ev.char_start < h.char_end,
  );
}

/** Tokens are stored per step ({"generate": {"in": 41, "out": 1423}}); older runs kept one flat object. */
function tokensOf(r: QuestionResult, step: string): { in: number; out: number } | null {
  const t = r.tokens[step];
  return t && typeof t === "object" ? { in: t.in ?? 0, out: t.out ?? 0 } : null;
}

/**
 * One question, fully explained, in the right half of the Questions page: the score, our answer next to the
 * gold answer with the judge's reason, the evidence, the same question in another version, and per-step numbers.
 */
export function QuestionDetail({
  r,
  verdict,
  position,
  onClose,
  onStep,
}: {
  r: QuestionResult;
  verdict: Verdict | null;
  position: { index: number; total: number };
  onClose: () => void;
  onStep: (by: number) => void;
}) {
  const { reference, refMode, experiments } = useVersion();
  const defs = useMetricDefs();
  const question = useEvalQuestion(r.question_id);
  const hits = useRetrievalHits(r.run_id, r.question_id);
  const stepIds = experiments.find((e) => e.id === r.experiment_id)?.step_ids ?? [];
  const scroller = useRef<HTMLDivElement>(null);

  // a new question starts at the top
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [r.question_id]);

  const primary = defFor(r.primary_metric, defs.data);
  const refScore = refMode === "parent" ? r.parent_score : r.baseline_score;
  const d = r.score != null && refScore != null ? r.score - refScore : null;
  const secondary = Object.entries(r.metrics)
    .filter(([k]) => k !== primary.name)
    .map(([k, v]) => [defFor(k, defs.data), v] as const)
    .filter(([def]) => def.grp !== "ops")
    .sort((a, b) => a[0].sort - b[0].sort);
  const correct = r.score != null ? r.score >= 0.5 : null;
  const shownScore = useTween(r.score);

  return (
    <article className="q-detail" aria-label={`Question ${r.external_id}`}>
      <header className="q-detail-bar">
        <span className="q-detail-id">
          <VerdictMark v={reference ? verdict : null} />
          {r.external_id}
          <span className="q-type">{r.qtype.replace(/_/g, " ")}</span>
        </span>
        <span className="q-detail-nav">
          <span className="key-hint num">
            {position.index + 1} / {position.total}
          </span>
          <button type="button" className="icon-btn" onClick={() => onStep(-1)} aria-label="Previous question (↑)">
            <ChevronUp />
          </button>
          <button type="button" className="icon-btn" onClick={() => onStep(1)} aria-label="Next question (↓)">
            <ChevronDown />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close (Esc)">
            <X />
          </button>
        </span>
      </header>

      {/* keyed by question: a new question replays the sections' rise */}
      <div className="q-detail-scroll" ref={scroller} key={r.question_id}>
        <section className="q-hero">
          <h2 className="q-question">{r.question}</h2>
          <div className="q-score">
            <div className={`q-score-num ${correct == null ? "" : correct ? "is-right" : "is-wrong"}`}>
              <span className="label">{primary.label}</span>
              <span className="num">{formatValue(shownScore, primary.format).value}</span>
              {d != null && Math.abs(d) >= 0.005 ? (
                <span className={`delta ${direction(d, true, 0.005)}`}>
                  {formatDelta(d, primary.format)} vs {reference?.slug}
                </span>
              ) : null}
            </div>
            <dl className="q-score-rest">
              {secondary.map(([def, v]) => (
                <div key={def.name}>
                  <dt className="label">{def.label}</dt>
                  <dd className="num">{formatValue(v, def.format).value}</dd>
                </div>
              ))}
              <div>
                <dt className="label">Latency</dt>
                <dd className="num">
                  {formatValue(r.latency_total_ms, "ms").value}
                  <small>{formatValue(r.latency_total_ms, "ms").unit}</small>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <AnswerVsGold r={r} facts={question.data?.answer_facts ?? []} correct={correct} />
        <EvidenceSection
          r={r}
          evidence={question.data?.evidence}
          hits={hits.data ?? []}
          loading={hits.isLoading}
          stepIds={stepIds}
        />
        <CompareSection r={r} experiments={experiments} defaultOther={reference} primaryFormat={primary.format} />
        <StepsSection r={r} stepIds={stepIds} />
      </div>
    </article>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="q-section">
      <h3 className="section-head">
        {title}
        {count ? <span className="count">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** A long text shows its first lines; one click shows all of it. */
function Clamp({ children, lines = 14 }: { children: React.ReactNode; lines?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el) setLong(el.scrollHeight > el.clientHeight + 4);
  }, [children]);
  return (
    <div className="clamp-wrap">
      <div ref={ref} className={`clamp ${open ? "open" : ""}`} style={{ ["--lines" as string]: lines }}>
        {children}
      </div>
      {long || open ? (
        <button type="button" className="link clamp-toggle" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  );
}

function AnswerVsGold({ r, facts, correct }: { r: QuestionResult; facts: unknown[]; correct: boolean | null }) {
  return (
    <Section title="Answer vs gold">
      <div className="halves">
        <div className="half">
          <div className="half-head">
            <span className="axis">Answer · {r.slug}</span>
          </div>
          <Clamp>
            <Markdown text={r.answer ?? "No answer."} />
          </Clamp>
        </div>
        <div className="half gold">
          <div className="half-head">
            <span className="axis">Gold answer</span>
          </div>
          <Markdown text={r.gold_answer ?? "No gold answer."} />
          {facts.length ? (
            <>
              <div className="half-sub axis">Facts the judge checks · {facts.length}</div>
              <ul className="facts">
                {facts.map((f, i) => (
                  <li key={i}>{typeof f === "string" ? f : JSON.stringify(f)}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
      {r.judge_rationale ? (
        <div className={`judge ${correct == null ? "" : correct ? "is-right" : "is-wrong"}`}>
          <span className="judge-word">{correct == null ? "Judge" : correct ? "Judged correct" : "Judged wrong"}</span>
          <p>{r.judge_rationale}</p>
        </div>
      ) : null}
    </Section>
  );
}

function EvidenceSection({
  r,
  evidence,
  hits,
  loading,
  stepIds,
}: {
  r: QuestionResult;
  evidence: Evidence[] | undefined;
  hits: RetrievalHit[];
  loading: boolean;
  stepIds: string[];
}) {
  const stages = useMemo(() => hitStages(hits, stepIds), [hits, stepIds]);
  const final = finalStage(hits, stepIds);
  const [choice, setChoice] = useState<HitStage | null>(null);
  const stage = choice && stages.includes(choice) ? choice : final;
  const context = hits.filter((h) => h.stage === final);
  const shown = hits.filter((h) => h.stage === stage);
  const cited = new Map(r.citations.map((c) => [c.chunk_id, c.marker]));
  const nFound = evidence ? evidence.filter((e) => found(e, context)).length : 0;

  return (
    <Section title="Evidence" count={evidence?.length ? `${nFound} / ${evidence.length} gold found` : undefined}>
      <div className="evidence">
        <div className="ev-col">
          <div className="axis">Gold documents</div>
          {evidence?.length === 0 ? (
            <p className="muted">None. The documents don't answer this; the right answer is to say so.</p>
          ) : null}
          <ul className="ev-list">
            {evidence?.map((ev, i) => {
              const ok = found(ev, context);
              return (
                <li key={i} className={ok ? "found" : "missed"}>
                  <i className={ok ? "mark held" : "mark lost"} aria-hidden />
                  <div>
                    <div className="ev-title">{ev.document_title ?? `document ${ev.document_id}`}</div>
                    <div className="t-meta">{ok ? "retrieved" : "not retrieved"}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="ev-col">
          <div className="axis">Retrieved{shown.length ? ` · ${stage} · top ${shown.length}` : ""}</div>
          {stages.length > 1 ? (
            <Segmented<HitStage>
              ariaLabel="Retrieval stage"
              value={stage!}
              onChange={setChoice}
              options={stages.map((s) => ({ value: s, label: s === final ? `${s} · final` : s }))}
            />
          ) : null}
          {loading ? <p className="muted">Loading…</p> : null}
          {!loading && hits.length === 0 ? (
            <p className="muted">Nothing retrieved: {r.slug} answers without looking at any document.</p>
          ) : null}
          <ol className="ctx-list">
            {shown.map((h) => (
              <li key={`${h.stage}-${h.rank}`} className="ctx">
                <span className="ctx-rank num">{h.rank}</span>
                <div className="ctx-body">
                  <div className="ctx-head">
                    <i className={h.relevant ? "mark held" : "mark new"} title={h.relevant ? "Gold" : "Not gold"} />
                    <span className="ctx-doc">{h.document_title}</span>
                    {cited.get(h.chunk_id) ? <span className="cite no-link">{cited.get(h.chunk_id)}</span> : null}
                    <span className="ctx-score">{h.score != null ? h.score.toFixed(3) : ""}</span>
                  </div>
                  <p className="ctx-text">{h.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}

function CompareSection({
  r,
  experiments,
  defaultOther,
  primaryFormat,
}: {
  r: QuestionResult;
  experiments: Experiment[];
  defaultOther: Experiment | undefined;
  primaryFormat: string;
}) {
  const others = experiments.filter((e) => e.id !== r.experiment_id && e.latest_run_id);
  const [pick, setPick] = useState<number | null>(null);
  const otherId = pick ?? defaultOther?.id ?? others[others.length - 1]?.id;
  const other = experiments.find((e) => e.id === otherId);
  const results = useQuestionResults(other?.id);
  const row = results.data?.find((x) => x.question_id === r.question_id);

  return (
    <Section title="Compare">
      {others.length === 0 ? (
        <p className="muted">
          {r.slug} is the only version with a finished run. The next version's answer to this question shows up here,
          side by side.
        </p>
      ) : (
        <>
          <label className="compare-pick">
            <span className="label">{r.slug} vs</span>
            <select className="select" value={otherId} onChange={(e) => setPick(Number(e.target.value))}>
              {others.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.slug} · {e.name}
                </option>
              ))}
            </select>
          </label>
          <div className="halves">
            <ComparedHalf label={r.slug} row={r} format={primaryFormat} />
            {row ? (
              <ComparedHalf label={other!.slug} row={row} format={primaryFormat} />
            ) : (
              <div className="half">
                <p className="muted">
                  {results.isLoading ? "Loading…" : `${other?.slug} has no answer to this question.`}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function ComparedHalf({ label, row, format }: { label: string; row: QuestionResult; format: string }) {
  return (
    <div className="half">
      <div className="half-head">
        <span className="axis">{label}</span>
        <span className="num num-20">{formatValue(row.score, format).value}</span>
      </div>
      <Clamp lines={8}>
        <Markdown text={row.answer ?? "No answer."} />
      </Clamp>
      {row.judge_rationale ? <p className="half-judge">{row.judge_rationale}</p> : null}
    </div>
  );
}

function StepsSection({ r, stepIds }: { r: QuestionResult; stepIds: string[] }) {
  const steps = [...new Set([...stepIds, ...Object.keys(r.latency_ms).filter((k) => k !== "total")])].sort(
    (a, b) => stepRank(stepIds, a) - stepRank(stepIds, b),
  );
  const flatTokens =
    Object.keys(r.tokens).length && Object.values(r.tokens).every((v) => typeof v === "number")
      ? (r.tokens as Record<string, number>)
      : null;
  return (
    <Section title="Steps">
      <div className="steps-table" role="table">
        <div className="steps-row steps-head" role="row">
          <span role="columnheader">Step</span>
          <span role="columnheader">Latency</span>
          <span role="columnheader">Tokens in</span>
          <span role="columnheader">Tokens out</span>
          <span role="columnheader">Cost</span>
        </div>
        {steps.map((s) => {
          const t = tokensOf(r, s);
          const lat = r.latency_ms[s];
          const cost = r.cost?.[s];
          return (
            <div key={s} className="steps-row" role="row">
              <span role="cell" className="steps-name">
                {s}
              </span>
              <span role="cell">
                {lat != null ? `${formatValue(lat, "ms").value} ${formatValue(lat, "ms").unit}` : "—"}
              </span>
              <span role="cell">{t ? t.in.toLocaleString("en-US") : "—"}</span>
              <span role="cell">{t ? t.out.toLocaleString("en-US") : "—"}</span>
              <span role="cell">{cost != null ? formatUsd(cost) : "—"}</span>
            </div>
          );
        })}
      </div>
      {flatTokens ? (
        <p className="t-meta">
          This run stored tokens without naming the step: {flatTokens.prompt ?? 0} in · {flatTokens.completion ?? 0}{" "}
          out.
        </p>
      ) : null}
      {r.cost_usd != null ? <p className="t-meta">Total without the judge: {formatUsd(Number(r.cost_usd))}</p> : null}
    </Section>
  );
}
