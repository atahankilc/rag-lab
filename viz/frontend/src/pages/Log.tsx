import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { type LogFilters, useLog, useLogSummary } from "../api/hooks";
import type { LogEvent } from "../api/types";
import { Centered, ErrorNote, Loading } from "../components/Loading";
import { Readout } from "../components/Readout";
import { Segmented } from "../components/Segmented";
import { clockTime, formatInt, relativeTime } from "../lib/format";
import { useMedia } from "../lib/useMedia";
import { useVersion } from "../state/version";
import { LogInspector } from "./LogInspector";
import { ACTOR_LABEL, describe, KIND_LABEL } from "./logText";
import "./log.css";

const ACTORS = ["me", "system", "model"] as const;

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "").toUpperCase();
}

const toggleIn = (set: string[], x: string) => (set.includes(x) ? set.filter((y) => y !== x) : [...set, x]);

/** The append-only record of everything that happened, newest first. */
export function Log() {
  const { experiments } = useVersion();
  const [params, setParams] = useSearchParams();
  const [actors, setActors] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [slug, setSlug] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const wide = useMedia("(min-width: 761px)");

  // wait for a pause in typing before asking the server
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchText), 250);
    return () => window.clearTimeout(t);
  }, [searchText]);

  const filters: LogFilters = { actors, kinds, slug: slug === "all" ? null : slug, search };
  const log = useLog(filters);
  const summary = useLogSummary();

  const selectedId = params.get("event") ? Number(params.get("event")) : null;
  const select = (id: number | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id == null) next.delete("event");
      else next.set("event", String(id));
      return next;
    }, { replace: true });

  const events = useMemo(() => log.data?.pages.flat() ?? [], [log.data]);
  const slugOf = (id: number) => experiments.find((e) => e.id === id)?.slug;

  // counts for each chip, under the other active filters (search excluded: it runs on the server)
  const rows = summary.data ?? [];
  const inSlug = (s: string | null) => slug === "all" || (slug === "none" ? s == null : s === slug);
  const kindCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();
  for (const r of rows) {
    if (!inSlug(r.slug)) continue;
    if (actors.length === 0 || actors.includes(r.actor)) kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + r.n);
    if (kinds.length === 0 || kinds.includes(r.kind)) actorCounts.set(r.actor, (actorCounts.get(r.actor) ?? 0) + r.n);
  }
  const total = rows.reduce((s, r) => s + r.n, 0);
  const byActor = (a: string) => rows.filter((r) => r.actor === a).reduce((s, r) => s + r.n, 0);
  const last = rows.reduce<string | null>((m, r) => (m == null || r.last_ts > m ? r.last_ts : m), null);
  const versionSlugs = [...new Set(rows.map((r) => r.slug).filter((s): s is string => s != null))]
    .sort((a, b) => (experiments.findIndex((e) => e.slug === a) - experiments.findIndex((e) => e.slug === b)));
  const filtered = actors.length > 0 || kinds.length > 0 || slug !== "all" || search !== "";

  // group into days, newest first
  const days: { key: string; label: string; items: LogEvent[] }[] = [];
  for (const e of events) {
    const key = dayKey(e.ts);
    if (days[days.length - 1]?.key !== key) days.push({ key, label: dayLabel(e.ts), items: [] });
    days[days.length - 1].items.push(e);
  }

  const versionOptions = [
    { value: "all", label: "All" },
    ...versionSlugs.map((s) => ({ value: s, label: s })),
    { value: "none", label: "No version" },
  ];

  return (
    <div className="page-full">
      <div className="page-col log-col">
        <header className="page-head">
          <div className="page-head-row">
            <div>
              <h1 className="page-title">Log</h1>
              <p className="lede">
                Everything that happened, who or what did it, and what changed. Rows are only ever added, never
                edited or deleted.
              </p>
            </div>
            <div className="page-readouts">
              <Readout label="Events" value={formatInt(total)} />
              <Readout label="By me" value={formatInt(byActor("me"))} />
              <Readout label="By system" value={formatInt(byActor("system"))} />
              <Readout label="By model" value={formatInt(byActor("model"))} />
              <Readout label="Last event" value={last ? relativeTime(last) : "—"} unit={last ? "ago" : undefined} />
            </div>
          </div>

          <div className="filter-row">
            {versionOptions.length <= 10 && wide ? (
              <Segmented ariaLabel="Filter by version" label="Version" value={slug} onChange={setSlug} options={versionOptions} />
            ) : (
              <select className="select" aria-label="Filter by version" value={slug} onChange={(e) => setSlug(e.target.value)}>
                {versionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            <label className="log-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Search the log</span>
              <input className="input" type="search" placeholder="Search actions, notes, ids" value={searchText}
                     onChange={(e) => setSearchText(e.target.value)} />
            </label>
          </div>
          <div className="filter-row">
            {[...kindCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <button key={k} type="button" className="chip" aria-pressed={kinds.includes(k)} onClick={() => setKinds(toggleIn(kinds, k))}>
                {KIND_LABEL[k] ?? k} <span className="count">{n}</span>
              </button>
            ))}
            <span className="divider" aria-hidden="true" />
            {ACTORS.map((a) => (
              <button key={a} type="button" className="chip" aria-pressed={actors.includes(a)} onClick={() => setActors(toggleIn(actors, a))}>
                {ACTOR_LABEL[a]} <span className="count">{actorCounts.get(a) ?? 0}</span>
              </button>
            ))}
            {filtered ? (
              <button type="button" className="chip" onClick={() => { setActors([]); setKinds([]); setSlug("all"); setSearchText(""); }}>
                Clear <span className="x">×</span>
              </button>
            ) : null}
          </div>
        </header>

        {log.error ? <Centered><ErrorNote error={log.error} /></Centered> : null}
        {log.isLoading ? <div className="log-loading"><Loading label="Loading log" /></div> : null}
        {!log.isLoading && events.length === 0 ? <p className="t-empty">No event matches these filters.</p> : null}

        {days.map((d) => (
          <section key={d.key} className="log-day" aria-label={d.label}>
            <h2 className="axis log-day-head">{d.label}<span className="count">{d.items.length}</span></h2>
            <ol className="log-list">
              {d.items.map((e) => {
                const desc = describe(e, slugOf);
                return (
                  <li key={e.id}>
                    <button type="button" className={`log-row ${e.id === selectedId ? "selected" : ""}`}
                            aria-current={e.id === selectedId} onClick={() => select(e.id)}>
                      <span className={`log-node ${e.id === selectedId ? "sel" : desc.mark}`} aria-hidden="true" />
                      <span className="log-body">
                        <span className={`log-text ${desc.milestone ? "milestone" : ""} ${desc.mark === "lost" || desc.mark === "weak" ? "warn" : ""}`}>
                          {desc.text}
                        </span>
                        {e.note && e.action !== "experiment.create" ? <span className="log-note">{e.note}</span> : null}
                        <span className="log-meta">
                          {ACTOR_LABEL[e.actor] ?? e.actor}
                          {e.slug ? ` · ${e.slug}` : ""}
                          {` · ${clockTime(e.ts)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}

        {log.hasNextPage ? (
          <div className="log-more">
            <button type="button" className="pill" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>
              {log.isFetchingNextPage ? "Loading…" : "Load older events"}
            </button>
          </div>
        ) : events.length > 0 ? <p className="log-end axis">Start of the log</p> : null}
      </div>

      {selectedId != null ? (
        <LogInspector id={selectedId} loaded={events.find((e) => e.id === selectedId)} slugOf={slugOf} onClose={() => select(null)} />
      ) : null}
    </div>
  );
}
