import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useConfigDiff, useMetricDefs, useQuestionResults, useStepSummary } from "../api/hooks";
import type { ConfigDiffRow, MetricDef, StepSummary } from "../api/types";
import { Inspector, InspectorSection } from "../components/Inspector";
import { Centered, ErrorNote, Loading } from "../components/Loading";
import { Readout } from "../components/Readout";
import { RiseFall } from "../components/RiseFall";
import { flatten, showValue, stepChips } from "../lib/config";
import { defFor, direction, formatDelta, formatInt, formatUsd, formatValue } from "../lib/format";
import { useMedia } from "../lib/useMedia";
import { useVersion } from "../state/version";

// What the library's three fixed steps produce, for the funnel and their cards.
const LIBRARY_UNIT: Record<string, string> = { ingest: "Documents", chunk: "Chunks", embed: "Vectors" };

const HEADLINE = ["correctness", "recall_at_k", "mrr", "faithfulness", "latency_p50_ms", "cost_per_query_usd"];

/** How a step compares with the same step in the reference version. */
type Status = "same" | "changed" | "new" | "moved" | "removed" | "none";

type StepView = StepSummary & {
  ref?: StepSummary;
  status: Status;
  changedPaths: Set<string>;
  diff: ConfigDiffRow[];
  refPosition?: number; // 1-based position among the reference's own steps
  position?: number; // 1-based position among this version's own steps
};

const STATUS_FLAG: Partial<Record<Status, string>> = { new: "new", moved: "moved", removed: "removed" };

export function Pipeline() {
  const { current, reference } = useVersion();
  const steps = useStepSummary(current?.id);
  const refSteps = useStepSummary(reference?.id);
  const defs = useMetricDefs();
  const diff = useConfigDiff(reference?.id, current?.id);
  const results = useQuestionResults(current?.id);
  const [selectedId, setSelectedId] = useState<string>("chunk");
  const [inspecting, setInspecting] = useState(false);
  const wide = useMedia("(min-width: 1101px)");

  const views: StepView[] = useMemo(() => {
    const rows = steps.data ?? [];
    const refRows = refSteps.data ?? [];
    const diffRows = diff.data ?? [];
    const own = rows.filter((r) => r.phase === "query").map((r) => r.step_id);
    const refOwn = refRows.filter((r) => r.phase === "query").map((r) => r.step_id);
    // a step "moved" when its place among the steps both versions share is different
    const shared = own.filter((id) => refOwn.includes(id));
    const refShared = refOwn.filter((id) => own.includes(id));

    const view = (r: StepSummary, isRemoved = false): StepView => {
      const ref = refRows.find((x) => x.step_id === r.step_id);
      const mine = diffRows.filter((d) => d.path === r.diff_prefix || d.path.startsWith(r.diff_prefix + "."));
      let status: Status = "none";
      if (reference) {
        if (isRemoved) status = "removed";
        else if (!ref) status = "new";
        else if (r.phase === "query" && shared.indexOf(r.step_id) !== refShared.indexOf(r.step_id)) status = "moved";
        else status = mine.length ? "changed" : "same";
      }
      return {
        ...r,
        ref,
        status,
        diff: mine,
        changedPaths: new Set(mine.map((d) => d.path)),
        position: own.indexOf(r.step_id) + 1 || undefined,
        refPosition: refOwn.indexOf(r.step_id) + 1 || undefined,
      };
    };
    const removed = reference ? refRows.filter((r) => r.phase === "query" && !own.includes(r.step_id)) : [];
    return [...rows.map((r) => view(r)), ...removed.map((r) => view(r, true))];
  }, [steps.data, refSteps.data, diff.data, reference]);

  if (!current) return null;
  if (steps.error)
    return (
      <Centered>
        <ErrorNote error={steps.error} />
      </Centered>
    );
  if (steps.isLoading)
    return (
      <Centered>
        <Loading label="Loading pipeline" />
      </Centered>
    );

  const live = views.filter((v) => v.status !== "removed");
  const idx = Math.max(
    0,
    live.findIndex((v) => v.step_id === selectedId),
  );
  const sel = live[idx] ?? views[0];
  const goto = (i: number) => setSelectedId(live[(i + live.length) % live.length].step_id);
  const library = views.filter((v) => v.phase === "index");
  const perQuestion = views.filter((v) => v.phase === "query");
  const open = (id: string) => {
    setSelectedId(id);
    setInspecting(true);
  };

  const riseFall = (
    <RiseFall
      results={results.data ?? []}
      reference={reference}
      changedKeys={
        current.changed_keys.length && reference?.id === current.parent_id
          ? current.changed_keys
          : [
              ...new Set(
                (diff.data ?? []).map((d) =>
                  d.path.startsWith("steps.")
                    ? d.path.split(".")[1]
                    : d.path === "step_order"
                      ? "step order"
                      : d.path.split(".")[0],
                ),
              ),
            ]
      }
    />
  );

  return (
    <>
      <div className="hud-tl pipeline-tl">
        <div className="page-label section-head">
          Pipeline
          <span className="count">
            {current.slug} · {current.name}
          </span>
        </div>
        <Funnel views={live} />
        {sel ? (
          <div className="stepper">
            <button type="button" className="icon-btn" onClick={() => goto(idx - 1)} aria-label="Previous step">
              <ChevronLeft />
            </button>
            <span className="stepper-pos num">
              {idx + 1}/{live.length}
            </span>
            <button type="button" className="icon-btn" onClick={() => goto(idx + 1)} aria-label="Next step">
              <ChevronRight />
            </button>
            <button type="button" className="stepper-name" onClick={() => setInspecting(true)}>
              {sel.step_id}
            </button>
            <span className="stepper-what">{sel.description}</span>
          </div>
        ) : null}
      </div>

      <div className="pipeline-center">
        <Headline metrics={current.metrics} refMetrics={reference?.metrics} defs={defs.data} />
        <div className="flow-groups">
          <section className="flow-group library" aria-label="Library, built once">
            <h2 className="axis flow-group-head">Library · built once</h2>
            <ol className="flow">
              {library.map((s, i) => (
                <Fragment key={s.step_id}>
                  {i > 0 ? (
                    <li className="flow-arrow" aria-hidden="true">
                      →
                    </li>
                  ) : null}
                  <li>
                    <StepCard s={s} selected={s.step_id === sel?.step_id} onSelect={() => open(s.step_id)} />
                  </li>
                </Fragment>
              ))}
            </ol>
          </section>
          <section className="flow-group" aria-label="Per question, in order">
            <h2 className="axis flow-group-head">
              Per question · {perQuestion.filter((v) => v.status !== "removed").length} steps, in order
            </h2>
            {perQuestion.length === 0 ? (
              <p className="lede flow-empty">
                This version declares no steps. A spike lists them in its config (see the contract doc).
              </p>
            ) : (
              <ol className="flow">
                {perQuestion.map((s, i) => (
                  <Fragment key={`${s.step_id}-${s.status}`}>
                    {i > 0 ? (
                      <li className="flow-arrow" aria-hidden="true">
                        →
                      </li>
                    ) : null}
                    <li>
                      <StepCard
                        s={s}
                        selected={s.step_id === sel?.step_id && s.status !== "removed"}
                        onSelect={() => s.status !== "removed" && open(s.step_id)}
                      />
                    </li>
                  </Fragment>
                ))}
              </ol>
            )}
          </section>
        </div>
        {wide ? null : riseFall}
      </div>

      {wide ? <div className="bottom-center">{riseFall}</div> : null}

      {sel ? (
        <StepInspector open={inspecting} onClose={() => setInspecting(false)} s={sel} refSlug={reference?.slug} />
      ) : null}
    </>
  );
}

function Funnel({ views }: { views: StepView[] }) {
  const cells = views.filter((v) => v.item_count != null && (v.phase === "index" || v.item_count > 0));
  return (
    <ol className="funnel" aria-label="Items per step">
      {cells.map((v, i) => {
        const d = v.ref?.item_count != null && v.item_count != null ? v.item_count - v.ref.item_count : null;
        return (
          <Fragment key={v.step_id}>
            {i > 0 ? (
              <li className="funnel-arrow" aria-hidden="true">
                →
              </li>
            ) : null}
            <li>
              <Readout
                label={LIBRARY_UNIT[v.step_id] ?? v.step_id}
                value={formatInt(v.item_count)}
                delta={d ? `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString("en-US")}` : undefined}
              />
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function Headline({
  metrics,
  refMetrics,
  defs,
}: {
  metrics: Record<string, number>;
  refMetrics?: Record<string, number>;
  defs?: MetricDef[];
}) {
  const shown = HEADLINE.filter((m) => metrics[m] != null);
  if (shown.length === 0) return <p className="lede">No finished run for this version yet, so there are no numbers.</p>;
  return (
    <div className="headline">
      {shown.map((m) => {
        const def = defFor(m, defs);
        const f = formatValue(metrics[m], def.format);
        const d = refMetrics?.[m] != null ? metrics[m] - refMetrics[m] : null;
        return (
          <Readout
            key={m}
            label={def.label}
            value={f.value}
            unit={f.unit}
            delta={d != null ? formatDelta(d, def.format) : undefined}
            dir={direction(d, def.higher_is_better, def.format === "ratio" ? 0.005 : 1e-9)}
            title={def.description ?? undefined}
          />
        );
      })}
    </div>
  );
}

function StepCard({ s, selected, onSelect }: { s: StepView; selected: boolean; onSelect: () => void }) {
  const chips = stepChips(s.config, s.diff_prefix);
  const d = s.p50_ms != null && s.ref?.p50_ms != null ? s.p50_ms - s.ref.p50_ms : null;
  const library = s.phase === "index";
  const flag = STATUS_FLAG[s.status];

  return (
    <button
      type="button"
      className={`stage-card ${s.status === "removed" ? "absent" : ""} ${selected ? "selected" : ""}`}
      onClick={onSelect}
      disabled={s.status === "removed"}
      aria-label={`${s.step_id}, ${s.kind_label}${s.status !== "none" && s.status !== "same" ? `, ${s.status}` : ""}`}
    >
      <span className={`stage-mark ${s.status} ${selected ? "sel" : ""}`} />
      <span className="section-head stage-name">
        {s.step_id}
        {flag ? <span className={`stage-flag ${s.status}`}>{flag}</span> : null}
      </span>
      {s.kind !== s.step_id ? <span className="stage-kind">{s.kind_label}</span> : null}
      <span className="stage-chips">
        {s.location ? <span className={`loc ${s.location}`}>{s.location}</span> : null}
        {chips.slice(0, 6).map((c) => (
          <span key={c.path} className={`kv-chip ${s.changedPaths.has(c.path) ? "changed" : ""}`} title={c.path}>
            {c.label ? <span className="k">{c.label}</span> : null}
            {c.value}
          </span>
        ))}
        {chips.length > 6 ? (
          <span className="kv-chip">
            <span className="k">+{chips.length - 6}</span>
          </span>
        ) : null}
      </span>
      {s.status === "removed" ? (
        <span className="stage-figure">
          <span className="label">not in this version</span>
        </span>
      ) : library ? (
        <span className="stage-figure">
          <span className="num num-20">{formatInt(s.item_count)}</span>
          <span className="label">{(LIBRARY_UNIT[s.step_id] ?? "items").toLowerCase()} · built once</span>
        </span>
      ) : (
        <span className="stage-figure">
          <span className="stage-figure-row">
            <span className="num num-20">{s.p50_ms != null ? formatValue(s.p50_ms, "ms").value : "—"}</span>
            <span className="readout-unit">{s.p50_ms != null ? formatValue(s.p50_ms, "ms").unit : ""}</span>
            {d != null && Math.abs(d) >= 1 ? (
              <span className={`delta ${direction(d, false, 1)}`}>{formatDelta(d, "ms")}</span>
            ) : null}
          </span>
          <span className="label">
            p50{s.p95_ms != null ? ` · p95 ${formatValue(s.p95_ms, "ms").value}` : ""}
            {s.cost_per_query_usd ? ` · ${formatUsd(Number(s.cost_per_query_usd))}/q` : ""}
          </span>
        </span>
      )}
    </button>
  );
}

const STATUS_TEXT: Record<Status, (s: StepView, ref?: string) => string> = {
  none: () => "No reference version to compare with.",
  same: (_, ref) => `Same as in ${ref}.`,
  changed: (_, ref) => `Settings changed since ${ref}.`,
  new: (_, ref) => `New: ${ref} doesn't have this step.`,
  moved: (s, ref) => `Moved: step ${s.position} here, step ${s.refPosition} in ${ref}.`,
  removed: (_, ref) => `Only in ${ref}.`,
};

function StepInspector({
  open,
  onClose,
  s,
  refSlug,
}: {
  open: boolean;
  onClose: () => void;
  s: StepView;
  refSlug?: string;
}) {
  const rows = flatten(s.config);
  const changed = new Map(s.diff.map((d) => [d.path, d]));
  const ref = s.ref;
  const library = s.phase === "index";
  const markClass = s.status === "new" ? "new" : s.status === "changed" || s.status === "moved" ? "changed" : "held";
  const ms = (v: number | null | undefined) =>
    v != null ? `${formatValue(v, "ms").value} ${formatValue(v, "ms").unit}` : "—";

  const figure = library ? (
    <Readout
      label={LIBRARY_UNIT[s.step_id] ?? "Items"}
      value={formatInt(s.item_count)}
      size={34}
      delta={
        ref?.item_count != null && s.item_count != null && s.item_count !== ref.item_count
          ? `${s.item_count > ref.item_count ? "+" : "−"}${Math.abs(s.item_count - ref.item_count)}`
          : undefined
      }
    />
  ) : (
    <>
      <Readout
        label="Latency p50"
        size={34}
        value={s.p50_ms != null ? formatValue(s.p50_ms, "ms").value : "—"}
        unit={s.p50_ms != null ? formatValue(s.p50_ms, "ms").unit : undefined}
        delta={s.p50_ms != null && ref?.p50_ms != null ? formatDelta(s.p50_ms - ref.p50_ms, "ms") : undefined}
        dir={s.p50_ms != null && ref?.p50_ms != null ? direction(s.p50_ms - ref.p50_ms, false, 1) : "flat"}
      />
      <Readout label="Items" size={34} value={formatInt(s.item_count)} />
    </>
  );

  return (
    <Inspector
      open={open}
      onClose={onClose}
      label={`${s.step_id} step`}
      layer={`${s.step_id} · ${s.kind_label}${library ? " · library" : ` · step ${s.position}`}`}
      layerMark={<i className={`mark ${markClass}`} />}
      what={s.description}
      title={
        (rows.find(([p]) => p.endsWith("model"))?.[1] as string) ?? (rows[0] ? showValue(rows[0][1]) : s.kind_label)
      }
      figure={figure}
    >
      <InspectorSection title={refSlug ? `Compared with ${refSlug}` : "Compared with"}>
        <p className="prov-fine">{STATUS_TEXT[s.status](s, refSlug)}</p>
        {s.diff.map((d) => (
          <div key={d.path} className="kv-row changed">
            <span className="k">{d.path.slice(s.diff_prefix.length + 1) || d.path}</span>
            <span className="v">
              {showValue(d.b_value)}
              <span className="was">was {showValue(d.a_value)}</span>
            </span>
          </div>
        ))}
      </InspectorSection>

      <InspectorSection title="Settings" count={s.location ? s.location.toUpperCase() : undefined}>
        <div className="kv-row">
          <span className="k">kind</span>
          <span className="v">{s.kind}</span>
        </div>
        {s.provider_id ? (
          <div className="kv-row">
            <span className="k">provider</span>
            <span className="v">{s.provider_id}</span>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="muted">No settings.</p>
        ) : (
          rows.map(([path, v]) => {
            const c = changed.get(`${s.diff_prefix}.${path}`);
            return (
              <div key={path} className={`kv-row ${c ? "changed" : ""}`}>
                <span className="k">{path}</span>
                <span className="v">
                  {showValue(v)}
                  {c ? <span className="was">was {showValue(c.a_value)}</span> : null}
                </span>
              </div>
            );
          })
        )}
      </InspectorSection>

      {!library ? (
        <InspectorSection title="Per question">
          <Row k="Latency p50" v={ms(s.p50_ms)} was={ref?.p50_ms != null ? ms(ref.p50_ms) : undefined} />
          <Row k="Latency p95" v={ms(s.p95_ms)} was={ref?.p95_ms != null ? ms(ref.p95_ms) : undefined} />
          <Row
            k="Cost per question"
            v={s.cost_per_query_usd != null ? formatUsd(Number(s.cost_per_query_usd)) : "—"}
            was={ref?.cost_per_query_usd != null ? formatUsd(Number(ref.cost_per_query_usd)) : undefined}
          />
          <Row k="Cost, whole run" v={s.cost_usd != null ? formatUsd(Number(s.cost_usd)) : "—"} />
          <Row
            k="Items produced"
            v={formatInt(s.item_count)}
            was={ref?.item_count != null ? formatInt(ref.item_count) : undefined}
          />
        </InspectorSection>
      ) : null}
    </Inspector>
  );
}

function Row({ k, v, was }: { k: string; v: string; was?: string }) {
  return (
    <div className="kv-row">
      <span className="k">{k}</span>
      <span className="v">
        {v}
        {was && was !== v ? <span className="was">was {was}</span> : null}
      </span>
    </div>
  );
}
