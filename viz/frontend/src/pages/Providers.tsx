import { useSearchParams } from "react-router";
import { useDefaultModels, useProviders, useProviderUsage, useSetProviderEnabled } from "../api/hooks";
import { LOCKED_HINT, useAuth } from "../state/auth";
import type { Provider } from "../api/types";
import { Centered, ErrorNote, Loading } from "../components/Loading";
import { Readout } from "../components/Readout";
import { formatUsd } from "../lib/format";
import { useMedia } from "../lib/useMedia";
import { ProviderInspector } from "./ProviderInspector";

export type ProviderStatus = "ready" | "unused" | "capped" | "off";

export const STATUS_LABEL: Record<ProviderStatus, string> = {
  ready: "Ready",
  unused: "Ready · unused",
  capped: "Cap reached",
  off: "Off",
};

/** Status comes from the database only: on/off, and spend vs cap. RAG Lab never calls the endpoints. */
export function providerStatus(p: Provider, used: boolean): ProviderStatus {
  if (!p.enabled) return "off";
  if (p.spend_cap_usd != null && Number(p.spent_usd) >= Number(p.spend_cap_usd)) return "capped";
  return used ? "ready" : "unused";
}

export function StatusMark({ status }: { status: ProviderStatus }) {
  const cls =
    status === "off"
      ? "mark new"
      : status === "capped"
        ? "mark weak"
        : status === "unused"
          ? "mark held dim-mark"
          : "mark held";
  return <i className={cls} aria-hidden="true" />;
}

/** "$0.02–$15 / 1M" over a provider's model prices, or "free" for local models. */
export function priceRange(p: Provider): string {
  const prices = p.models.flatMap((m) => [m.price_in_per_1m, m.price_out_per_1m]).filter((x): x is number => x != null);
  if (prices.length === 0) return "free";
  const lo = Math.min(...prices),
    hi = Math.max(...prices);
  const f = (x: number) => (x < 1 ? `$${x}` : `$${x.toFixed(x % 1 ? 2 : 0)}`);
  return lo === hi ? `${f(lo)} / 1M` : `${f(lo)}–${f(hi)} / 1M`;
}

/** Thin bar of spend against the cap: amber once the cap is reached. */
export function CapBar({ spent, cap }: { spent: number; cap: number | null }) {
  if (cap == null)
    return (
      <span className="bar" aria-hidden="true">
        <span style={{ width: 0 }} />
      </span>
    );
  const frac = cap > 0 ? Math.min(1, spent / cap) : 1;
  return (
    <span
      className={`bar thick ${spent >= cap ? "limit" : ""}`}
      role="img"
      aria-label={`${formatUsd(spent)} of ${formatUsd(cap)} cap`}
    >
      <span style={{ width: `${frac * 100}%` }} />
    </span>
  );
}

export function Providers() {
  const providers = useProviders();
  const usage = useProviderUsage();
  const defaults = useDefaultModels();
  const toggle = useSetProviderEnabled();
  const { canWrite } = useAuth();
  const [params, setParams] = useSearchParams();
  const md = useMedia("(min-width: 901px)");

  const selectedId = params.get("provider");
  const select = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id == null) next.delete("provider");
        else next.set("provider", id);
        return next;
      },
      { replace: true },
    );

  if (providers.error)
    return (
      <Centered>
        <ErrorNote error={providers.error} />
      </Centered>
    );
  if (providers.isLoading)
    return (
      <Centered>
        <Loading label="Loading providers" />
      </Centered>
    );

  const all = providers.data ?? [];
  const usedBy = (id: string) => (usage.data ?? []).filter((u) => u.provider_id === id);
  const statuses = new Map(all.map((p) => [p.id, providerStatus(p, usedBy(p.id).length > 0)]));
  const spent = all.reduce((s, p) => s + Number(p.spent_usd), 0);
  const selected = all.find((p) => p.id === selectedId);
  const cols = md
    ? "minmax(180px, 1.2fr) 70px minmax(150px, 1fr) 130px minmax(140px, 1fr) 120px 150px 44px"
    : "minmax(0, 1fr) 96px 44px";

  return (
    <div className="page-full">
      <div className="page-col">
        <header className="page-head">
          <div className="page-head-row">
            <div>
              <h1 className="page-title">Providers</h1>
              <p className="lede">
                Where models run: on this machine or in the cloud. The list comes from <code>viz/providers.json</code>(
                <code>make providers</code> after editing it). Turn a provider off or cap its spend here; a backend
                reads both before calling it. API keys stay in <code>.env</code> and are never stored here.
              </p>
            </div>
            <div className="page-readouts">
              <Readout label="Providers" value={String(all.length)} />
              <Readout label="Enabled" value={String(all.filter((p) => p.enabled).length)} />
              <Readout label="Spent, all time" value={formatUsd(spent)} />
              <Readout
                label="Cap reached"
                value={String([...statuses.values()].filter((s) => s === "capped").length)}
              />
            </div>
          </div>
          <div className="t-row t-head" style={{ ["--cols" as string]: cols }}>
            <span>Provider</span>
            {md ? (
              <>
                <span>Where</span>
                <span>Endpoint</span>
                <span>Status</span>
                <span>Models</span>
                <span className="t-num">Price</span>
                <span>Spend</span>
              </>
            ) : (
              <span>Status</span>
            )}
            <span className="t-num">On</span>
          </div>
        </header>

        <div className="t-table" aria-label="Providers">
          {all.map((p) => {
            const status = statuses.get(p.id)!;
            const pending = toggle.isPending && toggle.variables?.provider_id === p.id;
            return (
              <div
                key={p.id}
                className={`t-row prov-row ${p.enabled ? "" : "off"}`}
                style={{ ["--cols" as string]: cols }}
                aria-current={p.id === selectedId}
                onClick={() => select(p.id)}
              >
                <span className="t-name">
                  <button
                    type="button"
                    className="main prov-name"
                    onClick={(e) => {
                      e.stopPropagation();
                      select(p.id);
                    }}
                  >
                    {p.name}
                  </button>
                  <span className="sub">
                    {p.kind}
                    {!md ? ` · ${p.location}` : ""}
                  </span>
                </span>
                {md ? (
                  <>
                    <span className="cell">
                      <span className={`loc ${p.location}`}>{p.location}</span>
                    </span>
                    <span className="cell prov-endpoint" title={p.endpoint ?? ""}>
                      {p.endpoint ?? "—"}
                    </span>
                    <span className="cell prov-status">
                      <StatusMark status={status} /> {STATUS_LABEL[status]}
                    </span>
                    <span className="cell t-name">
                      <span className="main">
                        {p.models.length} model{p.models.length === 1 ? "" : "s"}
                      </span>
                      <span className="sub prov-models">{p.models.map((m) => m.name).join(" · ")}</span>
                    </span>
                    <span className="cell t-num">
                      <span className="t-val">{priceRange(p)}</span>
                    </span>
                    <span className="cell prov-spend">
                      <span className="prov-spend-row">
                        <span className="t-val">{formatUsd(Number(p.spent_usd))}</span>
                        <span className="t-meta">
                          {p.spend_cap_usd != null ? `of ${formatUsd(Number(p.spend_cap_usd))}` : "no cap"}
                        </span>
                      </span>
                      <CapBar
                        spent={Number(p.spent_usd)}
                        cap={p.spend_cap_usd != null ? Number(p.spend_cap_usd) : null}
                      />
                    </span>
                  </>
                ) : (
                  <span className="cell prov-status">
                    <StatusMark status={status} /> {STATUS_LABEL[status]}
                  </span>
                )}
                <span className="t-num prov-toggle">
                  <button
                    type="button"
                    role="switch"
                    className="toggle"
                    aria-checked={p.enabled}
                    disabled={pending || !canWrite}
                    title={canWrite ? undefined : LOCKED_HINT}
                    aria-label={`${p.name} ${p.enabled ? "on" : "off"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle.mutate({ provider_id: p.id, enabled: !p.enabled });
                    }}
                  />
                </span>
              </div>
            );
          })}
          {toggle.error ? <p className="run-error">{(toggle.error as Error).message}</p> : null}
        </div>

        <section className="section roles">
          <h2 className="section-head">Default model per step kind</h2>
          <div className="t-row t-head roles-row">
            <span>Step kind</span>
            <span>Model</span>
            <span>Provider</span>
            <span>Where</span>
          </div>
          {(defaults.data ?? []).length === 0 ? <p className="t-empty">No defaults set.</p> : null}
          {(defaults.data ?? []).map((r) => (
            <div key={r.kind} className="t-row roles-row">
              <span className="t-name">
                <span className="main">{r.kind_label}</span>
                <span className="sub">{r.kind}</span>
              </span>
              <span className="t-val">{r.model}</span>
              <span className="cell">
                {all.find((p) => p.id === r.provider_id)?.name ?? r.provider_id}
                {!r.enabled ? <span className="role-warn"> · provider is off</span> : null}
              </span>
              <span className="cell">
                <span className={`loc ${r.location}`}>{r.location}</span>
              </span>
            </div>
          ))}
          <p className="lede roles-note">
            Used when a version's step doesn't name a model. Set them under <code>"defaults"</code> in
            <code> viz/providers.json</code>, keyed by step kind, then run <code>make providers</code>.
          </p>
        </section>
      </div>

      {selected ? (
        <ProviderInspector
          provider={selected}
          status={statuses.get(selected.id)!}
          usage={usedBy(selected.id)}
          defaultFor={(defaults.data ?? []).filter((r) => r.provider_id === selected.id).map((r) => r.kind_label)}
          onClose={() => select(null)}
        />
      ) : null}
    </div>
  );
}
