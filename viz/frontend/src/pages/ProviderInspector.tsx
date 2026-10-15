import { useEffect, useState } from "react";
import { useSetProviderCap, useSetProviderEnabled } from "../api/hooks";
import type { Provider, ProviderUsage } from "../api/types";
import { Inspector, InspectorSection } from "../components/Inspector";
import { Readout } from "../components/Readout";
import { formatInt, formatUsd } from "../lib/format";
import { LOCKED_HINT, LoginHint, useAuth } from "../state/auth";
import { CapBar, type ProviderStatus, STATUS_LABEL, StatusMark } from "./Providers";

const STATUS_TEXT: Record<ProviderStatus, string> = {
  ready: "On, under its cap, and used by at least one version.",
  unused: "On, but no version uses it yet.",
  capped: "On, but spend has reached the cap. A backend should stop calling it.",
  off: "Off: a backend must not call it, even if a version names it.",
};

/** One provider: on/off, the spend cap, its models, and which versions use it. */
export function ProviderInspector({
  provider: p,
  status,
  usage,
  defaultFor,
  onClose,
}: {
  provider: Provider;
  status: ProviderStatus;
  usage: ProviderUsage[];
  defaultFor: string[];
  onClose: () => void;
}) {
  const toggle = useSetProviderEnabled();
  const setCap = useSetProviderCap();
  const { canWrite } = useAuth();
  const hint = canWrite ? undefined : LOCKED_HINT;
  const spent = Number(p.spent_usd);
  const cap = p.spend_cap_usd != null ? Number(p.spend_cap_usd) : null;
  const [capText, setCapText] = useState(cap != null ? String(cap) : "");

  useEffect(() => setCapText(cap != null ? String(cap) : ""), [cap, p.id]);

  const capValue = capText.trim() === "" ? null : Number(capText);
  const capInvalid = capValue != null && (!Number.isFinite(capValue) || capValue < 0);
  const capChanged = capValue !== cap && !capInvalid;

  const saveCap = (e: React.FormEvent) => {
    e.preventDefault();
    if (capChanged && canWrite) setCap.mutate({ provider_id: p.id, cap_usd: capValue });
  };

  return (
    <Inspector
      open
      onClose={onClose}
      label={`Provider ${p.name}`}
      layer={`${p.name} · ${STATUS_LABEL[status]}`}
      layerMark={<StatusMark status={status} />}
      what={`${p.kind} · ${p.location} · ${p.endpoint ?? "no endpoint"}`}
      title={`${p.models.length} model${p.models.length === 1 ? "" : "s"} · used by ${usage.length} version${usage.length === 1 ? "" : "s"}`}
      figure={
        <>
          <Readout
            label="Spent"
            size={34}
            value={formatUsd(spent)}
            unit={cap != null ? `of ${formatUsd(cap)}` : undefined}
          />
          <Readout label="Questions" size={34} value={formatInt(p.queries)} />
        </>
      }
    >
      <InspectorSection title="Status">
        <div className="kv-row prov-switch">
          <span className="k">Enabled</span>
          <span className="v">
            <button
              type="button"
              role="switch"
              className="toggle"
              aria-checked={p.enabled}
              disabled={toggle.isPending || !canWrite}
              title={hint}
              aria-label={`${p.name} ${p.enabled ? "on" : "off"}`}
              onClick={() => toggle.mutate({ provider_id: p.id, enabled: !p.enabled })}
            />
          </span>
        </div>
        <LoginHint what="turn it on or off, or change its cap" />
        <p className={`prov-status-text ${status === "capped" ? "warn" : ""}`}>{STATUS_TEXT[status]}</p>
        <p className="muted prov-fine">
          Status comes from the database only. RAG Lab never calls provider endpoints, so it can't tell whether a server
          is actually up.
        </p>
      </InspectorSection>

      <InspectorSection
        title="Spend cap"
        count={cap != null ? `${Math.round((spent / Math.max(cap, 1e-9)) * 100)}% used` : "none"}
      >
        <CapBar spent={spent} cap={cap} />
        <form className="cap-form" onSubmit={saveCap}>
          <label className="sr-only" htmlFor="cap-input">
            Spend cap in US dollars
          </label>
          <span className="cap-dollar">$</span>
          <input
            id="cap-input"
            className={`input ${capInvalid ? "invalid" : ""}`}
            inputMode="decimal"
            placeholder="no cap"
            disabled={!canWrite}
            title={hint}
            value={capText}
            onChange={(e) => setCapText(e.target.value)}
          />
          <button
            type="submit"
            className="pill small"
            disabled={!capChanged || setCap.isPending || !canWrite}
            title={hint}
          >
            {setCap.isPending ? "Saving…" : "Save cap"}
          </button>
          {cap != null ? (
            <button
              type="button"
              className="chip"
              disabled={setCap.isPending || !canWrite}
              title={hint}
              onClick={() => setCap.mutate({ provider_id: p.id, cap_usd: null })}
            >
              No cap <span className="x">×</span>
            </button>
          ) : null}
        </form>
        {capInvalid ? <p className="run-error">A cap is a positive number of dollars, or empty for no cap.</p> : null}
        {setCap.error ? <p className="run-error">{(setCap.error as Error).message}</p> : null}
        <p className="muted prov-fine">
          The cap is advisory: a backend checks it before each call. All-time spend, judge included.
        </p>
      </InspectorSection>

      <InspectorSection title="Models" count={p.models.length}>
        {p.models.map((m) => (
          <div key={m.name} className="prov-model">
            <div className="kv-row">
              <span className="k prov-model-name">{m.name}</span>
              <span className="v">
                {m.price_in_per_1m == null && m.price_out_per_1m == null
                  ? "free"
                  : `$${m.price_in_per_1m ?? 0} in${m.price_out_per_1m != null ? ` · $${m.price_out_per_1m} out` : ""}`}
              </span>
            </div>
            <div className="t-meta">
              {(m.kinds ?? []).join(" · ")}
              {m.dim ? ` · ${m.dim} dims` : ""}
              {m.price_in_per_1m != null ? " · per 1M tokens" : ""}
            </div>
          </div>
        ))}
      </InspectorSection>

      <InspectorSection title="Default for">
        {defaultFor.length === 0 ? (
          <p className="muted">No role uses it by default.</p>
        ) : (
          <p className="prov-roles">{defaultFor.join(" · ")}</p>
        )}
      </InspectorSection>

      <InspectorSection title="Used by" count={usage.length || undefined}>
        {usage.length === 0 ? (
          <p className="muted">No version names this provider in its config.</p>
        ) : (
          usage.map((u) => (
            <div key={u.experiment_id} className="kv-row">
              <span className="k">
                <span className="timeline-slug">{u.slug}</span> {u.step_ids.join(" · ")}
              </span>
              <span className="v">{formatUsd(Number(u.spent_usd))}</span>
            </div>
          ))
        )}
      </InspectorSection>

      <InspectorSection title="Keys">
        <p className="muted prov-fine">
          {p.key_env ? (
            <>
              The backend reads this provider's key from <code>{p.key_env}</code> in <code>.env</code>.
            </>
          ) : (
            <>No key: a local provider.</>
          )}{" "}
          The database never stores keys, so neither does this page.
        </p>
      </InspectorSection>
    </Inspector>
  );
}
