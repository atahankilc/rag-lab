import { useSearchParams } from "react-router";
import { useConfigDiff, useMetricDefs } from "../api/hooks";
import type { Experiment, MetricDef } from "../api/types";
import { Centered, ErrorNote, Loading } from "../components/Loading";
import { showValue } from "../lib/config";
import { defFor, direction, formatDelta, formatValue } from "../lib/format";
import { useVersion } from "../state/version";

const GROUPS: { key: MetricDef["grp"] | "other"; label: string }[] = [
  { key: "generation", label: "Generation" },
  { key: "retrieval", label: "Retrieval" },
  { key: "ops", label: "Cost and speed" },
  { key: "other", label: "Other" },
];

/** The other version of every Compare subpage: ?with=v2 in the URL, defaulting to the reference. */
export function useCompareOther() {
  const { current, reference, experiments } = useVersion();
  const [params, setParams] = useSearchParams();
  const others = experiments.filter((e) => e.id !== current?.id);
  const other = others.find((e) => e.slug === params.get("with")) ?? reference ?? others[others.length - 1];
  const pick = (slug: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("with", slug);
        return next;
      },
      { replace: true },
    );
  return { current, other, others, pick };
}

/** "v3 vs [v2 ▾]": the left side follows the timeline, the right side is picked here. */
export function ComparePicker({ id = "cmp-with" }: { id?: string }) {
  const { current, other, others, pick } = useCompareOther();
  if (!current || !other) return null;
  return (
    <div className="cmp-pick">
      <span className="cmp-side">
        <span className="timeline-slug">{current.slug}</span> {current.name}
      </span>
      <span className="muted">vs</span>
      <label className="sr-only" htmlFor={id}>
        Compare with
      </label>
      <select id={id} className="select" value={other.slug} onChange={(e) => pick(e.target.value)}>
        {others.map((e) => (
          <option key={e.id} value={e.slug}>
            {e.slug} · {e.name}
            {e.is_baseline ? " · baseline" : ""}
            {e.id === current.parent_id ? " · parent" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

const NOTHING = (
  <Centered>
    <p className="lede">There is only one version, so there is nothing to compare yet.</p>
  </Centered>
);

function CompareHead({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <header className="page-head">
      <h1 className="page-title">{title}</h1>
      <ComparePicker />
      <p className="lede">{children}</p>
    </header>
  );
}

/** Compare · Metrics: the headline numbers of two versions, with the change. */
export function Compare() {
  const { current, other } = useCompareOther();
  const defs = useMetricDefs();
  if (!current) return null;
  if (!other) return NOTHING;

  const names = [...new Set([...Object.keys(current.metrics), ...Object.keys(other.metrics)])];
  const rows = names.map((n) => defFor(n, defs.data)).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  return (
    <div className="page-full">
      <div className="page-col compare">
        <CompareHead title="Metrics">
          Change the left side with the timeline (← →). Green and red show where {current.slug} is better or worse than{" "}
          {other.slug}.
        </CompareHead>

        <section className="section">
          <div className="t-row t-head cmp-row">
            <span>Metric</span>
            <span className="t-num">{other.slug}</span>
            <span className="t-num">{current.slug}</span>
            <span className="t-num">Change</span>
          </div>
          {GROUPS.map((g) => {
            const inGroup = rows.filter((d) =>
              g.key === "other" ? !["generation", "retrieval", "ops"].includes(d.grp) : d.grp === g.key,
            );
            if (inGroup.length === 0) return null;
            return (
              <div key={g.key} className="cmp-group">
                <div className="axis cmp-group-label">{g.label}</div>
                {inGroup.map((d) => (
                  <MetricRow key={d.name} def={d} a={other} b={current} />
                ))}
              </div>
            );
          })}
          {rows.length === 0 ? <p className="t-empty">Neither version has a finished run yet.</p> : null}
        </section>
      </div>
    </div>
  );
}

/** Compare · Config: only the settings that differ. */
export function CompareConfig() {
  const { current, other } = useCompareOther();
  const diff = useConfigDiff(other?.id, current?.id);
  if (!current) return null;
  if (!other) return NOTHING;

  return (
    <div className="page-full">
      <div className="page-col compare">
        <CompareHead title="Config">
          Only the settings that differ, from the library (chunking, embedding) to every step, in the keyed form (
          <code>steps.rerank.top_n</code>, <code>step_order</code>).
        </CompareHead>

        <section className="section">
          <h2 className="section-head">
            Differs<span className="count">{diff.data?.length ?? ""}</span>
          </h2>
          {diff.error ? <ErrorNote error={diff.error} /> : null}
          {diff.isLoading ? <Loading label="Comparing configs" /> : null}
          {diff.data && diff.data.length === 0 ? <p className="t-empty">The two configs are identical.</p> : null}
          {diff.data && diff.data.length > 0 ? (
            <>
              <div className="t-row t-head cmp-diff-row">
                <span>Setting</span>
                <span>{other.slug}</span>
                <span>{current.slug}</span>
              </div>
              {diff.data.map((d) => (
                <div key={d.path} className="t-row cmp-diff-row">
                  <span className="cmp-path">{d.path}</span>
                  <span className={d.a_value == null ? "muted" : "cmp-old"}>{showValue(d.a_value)}</span>
                  <span className={d.b_value == null ? "muted" : "cmp-new"}>{showValue(d.b_value)}</span>
                </div>
              ))}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function MetricRow({ def, a, b }: { def: MetricDef; a: Experiment; b: Experiment }) {
  const va = a.metrics[def.name];
  const vb = b.metrics[def.name];
  const d = va != null && vb != null ? vb - va : null;
  const eps = def.format === "ratio" ? 0.005 : 1e-9;
  const dir = direction(d, def.higher_is_better, eps);
  const fa = formatValue(va, def.format, def.format === "ratio" ? 3 : undefined);
  const fb = formatValue(vb, def.format, def.format === "ratio" ? 3 : undefined);
  return (
    <div className="t-row cmp-row">
      <span className="t-name">
        <span className="main">{def.label}</span>
        {def.description ? <span className="sub">{def.description}</span> : null}
      </span>
      <span className="t-num t-val cmp-a">
        {fa.value}
        {fa.unit ? <span className="readout-unit"> {fa.unit}</span> : null}
      </span>
      <span className="t-num t-val">
        {fb.value}
        {fb.unit ? <span className="readout-unit"> {fb.unit}</span> : null}
      </span>
      <span className={`t-num delta ${dir === "flat" ? "" : dir}`}>
        {d == null ? "—" : formatDelta(d, def.format, def.format === "ratio" ? 3 : undefined)}
      </span>
    </div>
  );
}
