import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMetricDefs, useQuestionResults } from "../api/hooks";
import type { MetricDef, QuestionResult, Verdict } from "../api/types";
import { Centered, ErrorNote, Loading } from "../components/Loading";
import { Readout } from "../components/Readout";
import { Segmented } from "../components/Segmented";
import { defFor, direction, formatDelta, formatValue } from "../lib/format";
import { useMedia } from "../lib/useMedia";
import { useVersion } from "../state/version";
import { QuestionDetail } from "./QuestionDetail";

type VerdictFilter = "all" | Verdict;
type SortKey = "id" | "latency" | "delta" | string; // string = a metric name

export function Questions() {
  const { current, reference, refMode } = useVersion();
  const results = useQuestionResults(current?.id);
  const defs = useMetricDefs();
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "id", desc: false });
  // the open question lives in the URL (?q=qst_0007), so a link or the back button reopens it
  const [params, setParams] = useSearchParams();
  const openId = params.get("q");
  const setOpenId = useCallback(
    (id: string | null) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (id) next.set("q", id);
          else next.delete("q");
          return next;
        },
        // the browser morphs the old layout into the new one (styles/pages/questions.css), so opening a
        // question slides the list aside instead of jumping
        { replace: true, viewTransition: true },
      ),
    [setParams],
  );

  const xl = useMedia("(min-width: 1400px)");
  const lg = useMedia("(min-width: 1100px)");
  const md = useMedia("(min-width: 901px)");

  const rows = useMemo(() => results.data ?? [], [results.data]);
  const verdictOf = (r: QuestionResult) => (refMode === "parent" ? r.verdict_parent : r.verdict_baseline);
  const refMetricsOf = (r: QuestionResult) => (refMode === "parent" ? r.parent_metrics : r.baseline_metrics);
  const deltaOf = (r: QuestionResult) => (refMode === "parent" ? r.delta_parent : r.delta_baseline);

  // metric columns: every quality metric that appears in the data, known ones in metric_def order
  const metricCols = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.metrics)) names.add(k);
    return [...names]
      .map((n) => defFor(n, defs.data))
      .filter((d) => d.grp !== "ops")
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort - b.sort || a.name.localeCompare(b.name));
  }, [rows, defs.data]);
  const split = openId != null && md;
  // with a question open, the list keeps only what tells rows apart: id, question, the primary score
  const shownCols = !md ? [] : split ? metricCols.slice(0, 1) : metricCols.slice(0, xl ? 8 : lg ? 5 : 3);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.qtype, (m.get(r.qtype) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);

  const verdictCounts = { better: 0, worse: 0, unchanged: 0 };
  for (const r of rows) {
    const v = verdictOf(r);
    if (v) verdictCounts[v] += 1;
  }

  const visible = useMemo(() => {
    const out = rows.filter(
      (r) => (verdict === "all" || verdictOf(r) === verdict) && (tags.size === 0 || tags.has(r.qtype)),
    );
    const val = (r: QuestionResult): number | string => {
      if (sort.key === "id") return r.external_id;
      if (sort.key === "latency") return r.latency_total_ms ?? Infinity;
      if (sort.key === "delta") return deltaOf(r) ?? 0;
      return r.metrics[sort.key] ?? -Infinity;
    };
    return out.sort((a, b) => {
      const x = val(a),
        y = val(b);
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
  }, [rows, verdict, tags, sort, refMode]);

  const selected = rows.find((r) => r.external_id === openId);
  const selIndex = selected ? visible.findIndex((r) => r.question_id === selected.question_id) : -1;
  const stepBy = useCallback(
    (by: number) => {
      const next = visible[Math.min(visible.length - 1, Math.max(0, selIndex + by))];
      if (next) setOpenId(next.external_id);
    },
    [visible, selIndex, setOpenId],
  );

  // ↑ ↓ move through the visible rows while one is open; Esc closes it
  useEffect(() => {
    if (openId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setOpenId(null);
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      stepBy(e.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, stepBy, setOpenId]);

  // keep the open row in view when ↑ ↓ move past the edge of the list
  useEffect(() => {
    if (openId) document.getElementById(`q-${openId}`)?.scrollIntoView({ block: "nearest" });
  }, [openId]);

  if (!current) return null;
  if (results.error)
    return (
      <Centered>
        <ErrorNote error={results.error} />
      </Centered>
    );
  if (results.isLoading)
    return (
      <Centered>
        <Loading label="Loading questions" />
      </Centered>
    );
  if (rows.length === 0) {
    return (
      <Centered>
        <p className="lede">{current.slug} has no finished run yet, so there are no answers to show.</p>
      </Centered>
    );
  }

  const primary = metricCols.find((d) => d.is_primary) ?? metricCols[0];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const scoreMean = mean(rows.map((r) => r.metrics[primary.name]).filter((x): x is number => x != null));
  const refMean = mean(rows.map((r) => refMetricsOf(r)?.[primary.name]).filter((x): x is number => x != null));
  const lat = rows
    .map((r) => r.latency_total_ms)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null;
  const cols = !md
    ? "34px minmax(0, 1fr) 20px 48px"
    : split
      ? `64px minmax(0, 1fr) ${shownCols.map(() => "52px").join(" ")} 20px`
      : `72px minmax(220px, 1fr) ${shownCols.map(() => "72px").join(" ")} 28px 76px`;

  const toggleTag = (t: string) =>
    setTags((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  const sortBy = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, desc: !cur.desc } : { key, desc: key !== "id" && key !== "latency" }));

  return (
    <div className={`page-full q-page ${split ? "split" : ""}`}>
      <div className="page-col q-list">
        <header className="page-head">
          <div className="page-head-row">
            <div>
              <h1 className="page-title">Questions</h1>
              <p className="lede">
                {rows.length} questions · {current.slug} {current.name}
                {reference ? ` · compared with ${reference.slug}` : " · no reference to compare with"}
              </p>
            </div>
            <div className="page-readouts">
              <Readout
                label={primary.label}
                value={formatValue(scoreMean, primary.format).value}
                delta={
                  reference && scoreMean != null && refMean != null
                    ? formatDelta(scoreMean - refMean, primary.format)
                    : undefined
                }
                dir={scoreMean != null && refMean != null ? direction(scoreMean - refMean, true, 0.005) : "flat"}
              />
              <Readout label="Better" value={reference ? String(verdictCounts.better) : "—"} />
              <Readout label="Worse" value={reference ? String(verdictCounts.worse) : "—"} />
              <Readout label="Latency p50" value={formatValue(p50, "ms").value} unit={formatValue(p50, "ms").unit} />
            </div>
          </div>

          <div className="filter-row">
            <Segmented<VerdictFilter>
              ariaLabel="Filter by verdict"
              value={verdict}
              onChange={setVerdict}
              options={[
                { value: "all", label: "All", count: rows.length },
                { value: "better", label: "Better", count: verdictCounts.better, disabled: !reference },
                { value: "worse", label: "Worse", count: verdictCounts.worse, disabled: !reference },
                { value: "unchanged", label: "Unchanged", count: verdictCounts.unchanged, disabled: !reference },
              ]}
            />
            <span className="divider" aria-hidden="true" />
            {tagCounts.map(([t, n]) => (
              <button key={t} type="button" className="chip" aria-pressed={tags.has(t)} onClick={() => toggleTag(t)}>
                {t.replace(/_/g, " ")} <span className="count">{n}</span>
              </button>
            ))}
            {tags.size || verdict !== "all" ? (
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setTags(new Set());
                  setVerdict("all");
                }}
              >
                Clear <span className="x">×</span>
              </button>
            ) : null}
          </div>

          <div className="t-row t-head" style={{ ["--cols" as string]: cols }}>
            <SortHead label="ID" k="id" sort={sort} onSort={sortBy} />
            <span>Question</span>
            {shownCols.map((d) => (
              <SortHead
                key={d.name}
                label={d.label}
                k={d.name}
                sort={sort}
                onSort={sortBy}
                num
                title={d.description ?? undefined}
              />
            ))}
            <SortHead
              label="Δ"
              k="delta"
              sort={sort}
              onSort={sortBy}
              title={`Change in ${primary.label.toLowerCase()} vs the reference`}
            />
            {split ? null : md ? (
              <SortHead label="Latency" k="latency" sort={sort} onSort={sortBy} num />
            ) : (
              <SortHead label={primary.label.slice(0, 5)} k={primary.name} sort={sort} onSort={sortBy} num />
            )}
          </div>
        </header>

        <div className="t-table" aria-label="Questions">
          {visible.length === 0 ? <p className="t-empty">No question matches these filters.</p> : null}
          {visible.map((r) => (
            <QuestionRow
              key={r.question_id}
              r={r}
              cols={cols}
              metricCols={shownCols}
              md={md}
              split={split}
              primary={primary}
              verdict={verdictOf(r)}
              refMetrics={refMetricsOf(r)}
              hasRef={!!reference}
              selected={r.external_id === openId}
              onOpen={() => setOpenId(r.external_id)}
            />
          ))}
        </div>
      </div>

      {selected ? (
        <QuestionDetail
          r={selected}
          verdict={verdictOf(selected)}
          position={{ index: Math.max(0, selIndex), total: visible.length }}
          onClose={() => setOpenId(null)}
          onStep={stepBy}
        />
      ) : null}
    </div>
  );
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  num,
  title,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  num?: boolean;
  title?: string;
}) {
  const active = sort.key === k;
  return (
    <button
      type="button"
      className={num ? "t-num" : ""}
      aria-pressed={active}
      onClick={() => onSort(k)}
      title={title}
      aria-label={`Sort by ${label}${active ? (sort.desc ? ", descending" : ", ascending") : ""}`}
    >
      {label}
      {active ? (sort.desc ? " ↓" : " ↑") : ""}
    </button>
  );
}

export function VerdictMark({ v }: { v: Verdict | null }) {
  if (v === "better")
    return (
      <span className="verdict better" title="Better than the reference">
        ▲
      </span>
    );
  if (v === "worse")
    return (
      <span className="verdict worse" title="Worse than the reference">
        ▼
      </span>
    );
  if (v === "unchanged")
    return (
      <span className="verdict" title="Unchanged">
        <i className="mark held" style={{ width: 6, height: 6 }} />
      </span>
    );
  return (
    <span className="verdict none" title="No reference">
      —
    </span>
  );
}

function QuestionRow({
  r,
  cols,
  metricCols,
  md,
  split,
  primary,
  verdict,
  refMetrics,
  hasRef,
  selected,
  onOpen,
}: {
  r: QuestionResult;
  cols: string;
  metricCols: MetricDef[];
  md: boolean;
  split: boolean;
  primary: MetricDef;
  verdict: Verdict | null;
  refMetrics: Record<string, number> | null;
  hasRef: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const d =
    hasRef && r.metrics[primary.name] != null && refMetrics?.[primary.name] != null
      ? r.metrics[primary.name] - refMetrics[primary.name]
      : null;
  return (
    <button
      type="button"
      id={`q-${r.external_id}`}
      className="t-row q-row"
      style={{ ["--cols" as string]: cols }}
      aria-current={selected}
      onClick={onOpen}
      aria-label={`${r.external_id}: ${r.question}`}
    >
      <span className="t-id">{r.external_id}</span>
      <span className="t-name">
        <span className="main q-text">{r.question}</span>
        <span className="sub">
          {r.qtype.replace(/_/g, " ")}
          {r.tags
            .filter((t) => t !== r.qtype)
            .map((t) => ` · ${t}`)
            .join("")}
        </span>
      </span>
      {metricCols.map((def) => {
        const v = r.metrics[def.name];
        const rv = refMetrics?.[def.name];
        const delta = hasRef && v != null && rv != null ? v - rv : null;
        const dir = direction(delta, def.higher_is_better, 0.005);
        return (
          <span key={def.name} className="t-num">
            <span className="t-val">{formatValue(v, def.format).value}</span>
            <span className={`t-meta ${dir === "flat" ? "" : dir}`}>
              {delta != null && dir !== "flat" ? formatDelta(delta, def.format) : " "}
            </span>
          </span>
        );
      })}
      <VerdictMark v={hasRef ? verdict : null} />
      {split ? null : md ? (
        <span className="t-num">
          <span className="t-val">{formatValue(r.latency_total_ms, "ms").value}</span>
          <span className="t-meta">{formatValue(r.latency_total_ms, "ms").unit}</span>
        </span>
      ) : (
        <span className="t-num">
          <span className="t-val">{formatValue(r.metrics[primary.name], primary.format).value}</span>
          <span className={`t-meta ${direction(d, true, 0.005)}`}>
            {d != null && Math.abs(d) >= 0.005 ? formatDelta(d, primary.format) : " "}
          </span>
        </span>
      )}
    </button>
  );
}
