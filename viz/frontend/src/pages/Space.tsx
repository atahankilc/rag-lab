// Space: every chunk of a version's library as a point, placed by a projection of its embedding.
//
// Generic on purpose: the colours, filters and inspector use whatever fields the corpus has (see
// lib/fields.ts). A second version can be shown side by side (?cmp=). Moving the timeline between
// versions with the same chunks makes the points glide to their place in the new space. The view
// (comparison, projection, 2D/3D, colour, question, chunk) lives in the URL, so a link reproduces it.

import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  useExperimentDetail, useFieldStyles, useNeighbours, useQueryPoints, useQuestionResults, useRelevantPairs, useRunHits, useSpaceMethods,
  useSpacePoints,
} from "../api/hooks";
import type { Experiment, SpaceMethod } from "../api/types";
import { Centered, ErrorNote, Loading } from "../components/Loading";
import { Readout } from "../components/Readout";
import { Segmented } from "../components/Segmented";
import {
  applyScale, buildFields, type Field, formatFieldValue, GROUP_LABEL, makeScale, passes, retrievalStats, type Scale, usable,
} from "../lib/fields";
import { formatInt } from "../lib/format";
import { stepRank } from "../lib/steps";
import { useMedia } from "../lib/useMedia";
import { useTheme } from "../state/theme";
import { useVersion } from "../state/version";
import { ChunkInspector, type QuestionName } from "./ChunkInspector";
import { FieldsInspector } from "./FieldsInspector";
import { normalise, type Pane, type PanePoint, SpaceCanvas, type Target, type ViewCommand } from "./SpaceCanvas";
import { type Filters, FilterRow } from "./SpaceFilters";

/** The projection to show: the one asked for if this space has it, else UMAP, else the first. */
function pickMethod(methods: SpaceMethod[] | undefined, wanted: string | null | undefined): string | undefined {
  if (!methods?.length) return undefined;
  return methods.find((m) => m.method === wanted)?.method ?? methods.find((m) => m.method === "umap")?.method ?? methods[0].method;
}

/** Everything one version's side of the page needs. */
function useSide(exp: Experiment | undefined, method: string | undefined) {
  const points = useSpacePoints(exp?.embedding_space_id, method);
  const queries = useQueryPoints(exp?.embedding_space_id, method);
  const results = useQuestionResults(exp?.id);
  const runHits = useRunHits(exp?.latest_run_id ?? undefined);
  const relevant = useRelevantPairs(exp?.chunk_set_id);
  const stats = useMemo(() => retrievalStats(runHits.data, relevant.data, exp?.step_ids ?? []),
    [runHits.data, relevant.data, exp?.step_ids]);
  return { exp, points, queries, results, runHits, relevant, stats };
}
type Side = ReturnType<typeof useSide>;

/** The default colour: a document or chunk field with 2–8 values that most chunks have. */
function defaultColor(fields: Field[]): string | undefined {
  const cats = fields.filter((f) => usable(f) && f.kind === "category" && f.group !== "retrieval" && f.distinct <= 8);
  cats.sort((a, b) => b.present - a.present || a.distinct - b.distinct);
  return cats[0]?.id ?? fields.find(usable)?.id;
}

/** A version's space; a second version can be shown next to it (?cmp=v2). */
export function Space() {
  const { current, experiments } = useVersion();
  const [params] = useSearchParams();
  const other = experiments.find((e) => e.slug === params.get("cmp") && e.id !== current?.id);
  return <SpaceView other={other} />;
}

function SpaceView({ other }: { other: Experiment | undefined }) {
  const { current, experiments } = useVersion();
  const [params, setParams] = useSearchParams();
  const wide = useMedia("(min-width: 761px)");
  const stageW = useStageWidth();
  const [readoutRef, readoutH] = useHeight();
  const narrowSheet = useMedia("(max-width: 1100px)");

  const set = useCallback((patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) if (v == null || v === "") next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true }), [setParams]);

  // ---------- the view, from the URL ----------
  const questionId = Number(params.get("q")) || null;
  const selectedId = Number(params.get("chunk")) || null;
  const allQueries = params.get("all") === "1";
  const fieldsOpen = params.get("fields") === "1";

  const methods = useSpaceMethods(current?.embedding_space_id);
  const otherMethods = useSpaceMethods(other?.embedding_space_id);
  const method = pickMethod(methods.data, params.get("m"));
  const otherMethod = pickMethod(otherMethods.data, method);
  const info = methods.data?.find((m) => m.method === method);
  const otherInfo = otherMethods.data?.find((m) => m.method === otherMethod);
  const can3d = !!info?.has_z && (!other || !!otherInfo?.has_z);
  const three = params.get("d") === "3" && can3d;

  const detail = useExperimentDetail(current?.id);
  const corpusName = detail.data?.corpus.name;
  const styles = useFieldStyles(corpusName);

  const main = useSide(current, method);
  const second = useSide(other, other ? otherMethod : undefined);

  const [filters, setFilters] = useState<Filters>({});
  const [search, setSearch] = useState("");
  const [hover, setHover] = useState<Target | null>(null);
  const [command, setCommand] = useState<ViewCommand>({ n: 0, type: "reset" });

  // ---------- fields and colour ----------
  const mainFields = useMemo(() => buildFields(main.points.data ?? [], styles.data, main.stats),
    [main.points.data, styles.data, main.stats]);
  const secondFields = useMemo(() => (other ? buildFields(second.points.data ?? [], styles.data, second.stats) : []),
    [other, second.points.data, styles.data, second.stats]);
  const colorId = mainFields.some((f) => f.id === params.get("color") && usable(f)) ? params.get("color")! : defaultColor(mainFields);
  const colorField = mainFields.find((f) => f.id === colorId);
  // colours are resolved from the theme's tokens, so a theme change rebuilds them
  const { theme } = useTheme();
  const scale = useMemo(() => makeScale(colorField, [secondFields.find((f) => f.id === colorId)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorField, secondFields, colorId, theme]);

  // ---------- the panes ----------
  // this version, and on Compare · Space the other one next to it
  const sides: Side[] = other ? [main, second] : [main];
  const fieldsOf = (s: Side) => (s === main ? mainFields : secondFields);

  const mainPos = useMemo(() => toPane(main.points.data, three), [main.points.data, three]);
  const secondPos = useMemo(() => toPane(second.points.data, three), [second.points.data, three]);
  const posOf = (s: Side) => (s === main ? mainPos : secondPos);

  const selectedSide = sides.find((s) => s.points.data?.some((p) => p.chunk_id === selectedId));
  const selectedPoint = selectedSide?.points.data?.find((p) => p.chunk_id === selectedId);
  const hoverSide = hover ? sides[hover.pane] : undefined;
  const hoverPoint = hover?.kind === "chunk" ? hoverSide?.points.data?.find((p) => p.chunk_id === hover.id) : undefined;

  // question names, from results where there are any, else from the query points
  const questions = useMemo(() => {
    const m = new Map<number, QuestionName & { qtype: string }>();
    for (const q of [...(main.queries.data ?? []), ...(second.queries.data ?? [])]) {
      m.set(q.question_id, { id: q.question_id, external_id: q.external_id, question: q.question, qtype: q.qtype });
    }
    for (const r of [...(main.results.data ?? []), ...(second.results.data ?? [])]) {
      m.set(r.question_id, { id: r.question_id, external_id: r.external_id, question: r.question, qtype: r.qtype });
    }
    return m;
  }, [main.queries.data, main.results.data, second.queries.data, second.results.data]);
  const questionList = [...questions.values()].sort((a, b) => a.external_id.localeCompare(b.external_id));

  // the picked question's ranked lists in the main side, to choose which step to show
  const qStages = useMemo(() => {
    if (questionId == null) return [];
    const hits = (main.runHits.data ?? []).filter((h) => h.question_id === questionId);
    return [...new Set(hits.map((h) => h.stage))].sort((a, b) => stepRank(current?.step_ids ?? [], a) - stepRank(current?.step_ids ?? [], b));
  }, [main.runHits.data, questionId, current?.step_ids]);
  const finalStage = qStages[qStages.length - 1];
  const stage = qStages.includes(params.get("stage") ?? "") ? params.get("stage")! : finalStage;

  const searchIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const ids = new Set<number>();
    for (const p of [...(main.points.data ?? []), ...(second.points.data ?? [])]) {
      if (p.text.toLowerCase().includes(q) || (p.document_title ?? "").toLowerCase().includes(q) || p.document_external_id.toLowerCase().includes(q)) ids.add(p.chunk_id);
    }
    return ids;
  }, [search, main.points.data, second.points.data]);

  const panes: Pane[] = sides.map((s, i) => {
    const pts = s.points.data ?? [];
    const fields = fieldsOf(s);
    const activeFilters = Object.entries(filters).filter(([, f]) => !(f.kind === "in" && f.values.length === 0));
    const visible = activeFilters.length
      ? pts.map((_, k) => activeFilters.every(([id, f]) => { const fl = fields.find((x) => x.id === id); return !fl || passes(fl.values[k], f); }))
      : null;

    // the picked question, for this side: its list at the chosen step (or the side's final one)
    const qHits = questionId != null ? (s.runHits.data ?? []).filter((h) => h.question_id === questionId) : [];
    const sideStages = [...new Set(qHits.map((h) => h.stage))].sort((a, b) => stepRank(s.exp?.step_ids ?? [], a) - stepRank(s.exp?.step_ids ?? [], b));
    const sideStage = s === main ? stage : sideStages.includes(stage ?? "") ? stage : sideStages[sideStages.length - 1];
    const relevant = new Set((s.relevant.data ?? []).filter((r) => r.question_id === questionId).map((r) => r.chunk_id));
    const list = qHits.filter((h) => h.stage === sideStage).sort((a, b) => a.rank - b.rank);
    const inList = new Set(list.map((h) => h.chunk_id));
    const missed = questionId != null ? [...relevant].filter((id) => !inList.has(id)) : [];
    const qp = (s.queries.data ?? []).find((q) => q.question_id === questionId);
    const qpos = toQuery(s, three);

    let emphasis: Set<number> | null = null;
    if (questionId != null) emphasis = new Set([...inList, ...relevant]);
    if (searchIds) emphasis = new Set([...(emphasis ?? []), ...searchIds]);

    // the pointer or selection in the other pane: the same chunk, or the same document's chunks
    const otherSide = sides.length > 1 ? sides[1 - i] : undefined;
    const pointed = hover && otherSide && hover.pane === 1 - i ? (hoverPoint ?? null) : null;
    const linked = pointed ? linkTo(pts, pointed.chunk_id, pointed.document_id) : null;

    return {
      key: i === 0 ? "main" : "second",
      label: other ? `${s.exp?.slug} · ${s.exp?.embedding_model} · ${s.exp?.chunk_set_name}` : undefined,
      points: posOf(s),
      colors: applyScale(scale, fields.find((f) => f.id === colorId), pts.length),
      visible,
      emphasis,
      queries: allQueries ? qpos.all : [],
      focus: qp ? qpos.byId.get(qp.question_id) ?? null : null,
      hits: list.map((h) => ({ id: h.chunk_id, rank: h.rank, relevant: relevant.has(h.chunk_id) })),
      missed,
      selected: selectedSide === s ? selectedId : null,
      neighbours: [],
      linked,
    };
  });

  const selectedPane = selectedSide ? sides.indexOf(selectedSide) : -1;
  const neighbourIds = useNeighbourIds(selectedSide?.exp?.embedding_space_id, selectedId);
  if (selectedPane >= 0) panes[selectedPane].neighbours = neighbourIds;
  // the selected chunk in the other pane, too
  if (selectedPoint && sides.length > 1) {
    const o = 1 - selectedPane;
    panes[o].linked = new Set([...(panes[o].linked ?? []), ...(linkTo(sides[o].points.data ?? [], selectedPoint.chunk_id, selectedPoint.document_id) ?? [])]);
  }

  // drop a filter or search hit count when switching versions is not needed: fields are by id
  useEffect(() => { setHover(null); }, [current?.id, other?.id]);

  if (!current) return null;
  if (methods.error || main.points.error) return <Centered><ErrorNote error={methods.error ?? main.points.error} /></Centered>;
  if (methods.isLoading || main.points.isLoading) return <Centered><Loading label="Loading space" /></Centered>;
  if (!methods.data?.length) {
    return (
      <Centered>
        <div className="empty-state">
          <p className="section-head">No projection yet</p>
          <p className="lede">
            This version's embedding space has no 2D or 3D coordinates. A spike writes them into
            {" "}<code>lab.projection</code> (step 2 of <code>viz/docs/backend-contract.md</code>), for example with UMAP.
          </p>
        </div>
      </Centered>
    );
  }

  const space = detail.data?.embedding_space;
  const pts = main.points.data ?? [];
  const shown = panes[0].visible ? panes[0].visible.filter(Boolean).length : pts.length;
  const docs = new Set(pts.map((p) => p.document_id)).size;
  const focusName = questionId != null ? questions.get(questionId) : undefined;
  const mainPane = panes[sides.indexOf(main)] ?? panes[0];
  const relevantCount = mainPane.hits.filter((h) => h.relevant).length;
  const usableFields = mainFields.filter(usable);
  // the field fits between the top-left readout and the right edge, or the inspector when one is open
  const sheet = (selectedPoint != null || fieldsOpen) ? (narrowSheet ? 380 : 440) + 2 * 24 : 60;
  // one version on a wide stage: the field sits beside the readout column. Two versions, or a narrower
  // stage: the field sits below the readout and uses the full width.
  const beside = !other && stageW >= 1180;
  const insets = !wide ? { l: 16, r: 16, t: other ? 32 : 16, b: 16 }
    : beside ? { l: 600, r: sheet, t: 82, b: 190 }
    : { l: 40, r: sheet, t: 10 + readoutH + 44, b: 190 };
  const methodsHere = (methods.data ?? []).filter((m) => !other || (otherMethods.data ?? []).some((o) => o.method === m.method));

  const pickQuestion = (id: number | null) => set({ q: id != null ? String(id) : null, stage: null });
  const select = (id: number | null) => set({ chunk: id != null ? String(id) : null, fields: null });

  return (
    <>
      <SpaceCanvas
        panes={panes}
        three={three}
        insets={insets}
        command={command}
        onHover={setHover}
        onSelect={(_, id) => select(id)}
        onPickQuery={(id) => pickQuestion(id)}
        label={`Projection of ${pts.length} chunks${focusName ? `, with question ${focusName.external_id}` : ""}`}
      />

      <div className="hud-tl space-tl" ref={readoutRef}>
        <div className="page-label section-head">
          Space<span className="count">{current.slug} · {space?.model ?? current.embedding_model}</span>
        </div>
        <div className="space-readouts">
          <Readout label={shown < pts.length ? "Chunks shown" : "Chunks"} value={formatInt(shown)}
                   unit={shown < pts.length ? `of ${formatInt(pts.length)}` : undefined} />
          <Readout label="Documents" value={formatInt(docs)} />
          <Readout label="Dimensions" value={space ? formatInt(space.dim) : "—"} />
          {space ? <span className={`loc ${space.location}`}>{space.location}</span> : null}
        </div>

        {/* the controls: one label column, one control column; details sit under their control */}
        <div className="space-controls">
          <label className="ctl-label" htmlFor="space-cmp">Compare</label>
          <div className="ctl">
            <select id="space-cmp" className="select" value={other?.slug ?? ""} onChange={(e) => set({ cmp: e.target.value || null })}>
              <option value="">Only {current.slug}</option>
              {experiments.filter((e) => e.id !== current.id).map((e) => (
                <option key={e.id} value={e.slug}>
                  {current.slug} vs {e.slug} · {e.embedding_model} · {e.chunk_set_name}{e.chunk_set_id === current.chunk_set_id ? " · same chunks" : ""}
                </option>
              ))}
            </select>
          </div>

          <label className="ctl-label" htmlFor="space-q">Question</label>
          <div className="ctl">
            <select id="space-q" className="select" value={questionId ?? ""} onChange={(e) => pickQuestion(e.target.value ? Number(e.target.value) : null)}>
              <option value="">None · pick one to see what it retrieves</option>
              {questionList.map((q) => <option key={q.id} value={q.id}>{q.external_id} · {q.question}</option>)}
            </select>
            <button type="button" className="chip" aria-pressed={allQueries} onClick={() => set({ all: allQueries ? null : "1" })}
                    title="Show where every question lands">◇ All</button>
          </div>
          {questionId != null ? (
            <div className="ctl ctl-detail">
              {qStages.length > 1 ? (
                <Segmented ariaLabel="Which step's list to show" value={stage ?? ""} onChange={(v) => set({ stage: v === finalStage ? null : v })}
                           options={qStages.map((s) => {
                             const rel = new Set((main.relevant.data ?? []).filter((r) => r.question_id === questionId).map((r) => r.chunk_id));
                             return { value: s, label: s, count: (main.runHits.data ?? []).filter((h) => h.question_id === questionId && h.stage === s && rel.has(h.chunk_id)).length };
                           })} />
              ) : null}
              {mainPane.hits.length || mainPane.missed.length ? (
                <p className="space-summary">
                  <span><i className="mark sel" /> {mainPane.hits.length} in {stage}{stage === finalStage ? " (final)" : ""}</span>
                  <span><i className="mark strong" /> {relevantCount} relevant</span>
                  <span><i className="mark amber-ring" /> {mainPane.missed.length} missed</span>
                  {!mainPane.focus ? <span className="muted">· no query point in this projection</span> : null}
                </p>
              ) : <p className="space-summary muted">{current.slug} has no ranked lists for this question.</p>}
            </div>
          ) : null}

          <label className="ctl-label" htmlFor="space-color">Colour</label>
          <div className="ctl">
            <select id="space-color" className="select" value={colorId ?? ""} onChange={(e) => set({ color: e.target.value || null })}>
              {!usableFields.length ? <option value="">No field varies</option> : null}
              {[...new Set(usableFields.map((f) => f.group))].map((g) => (
                <optgroup key={g} label={GROUP_LABEL[g]}>
                  {usableFields.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </optgroup>
              ))}
            </select>
            <button type="button" className="chip" aria-pressed={fieldsOpen} onClick={() => set({ fields: fieldsOpen ? null : "1", chunk: null })}>
              Fields <span className="count">{mainFields.length}</span>
            </button>
          </div>
          <div className="ctl ctl-detail">
            <Legend scale={scale} field={colorField} shown={fieldsOf(sides[0]).find((f) => f.id === colorId)}
                    filters={filters} setFilters={setFilters} />
          </div>

          <span className="ctl-label">Filter</span>
          <div className="ctl">
            <FilterRow fields={mainFields} filters={filters} setFilters={setFilters} search={search} setSearch={setSearch}
                       scale={scale} colorField={colorField} />
          </div>
          {searchIds ? <p className="ctl ctl-detail space-summary muted">{searchIds.size} chunks match “{search.trim()}”</p> : null}
        </div>
      </div>

      <div className="space-view">
        <div className="space-view-row">
          <Segmented ariaLabel="2D or 3D" value={three ? "3" : "2"} onChange={(v) => set({ d: v === "3" ? "3" : null })}
                     options={[{ value: "2", label: "2D" }, { value: "3", label: "3D", disabled: !can3d }]} />
          {methodsHere.length > 1 ? (
            <Segmented ariaLabel="Projection method" value={method ?? ""} onChange={(m) => set({ m })}
                       options={methodsHere.map((m) => ({ value: m.method, label: m.method.toUpperCase() }))} />
          ) : <span className="axis">{method}</span>}
          <span className="space-view-btns">
            <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => setCommand((c) => ({ n: c.n + 1, type: "in" }))}><Plus /></button>
            <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => setCommand((c) => ({ n: c.n + 1, type: "out" }))}><Minus /></button>
            <button type="button" className="icon-btn" aria-label="Reset the view" onClick={() => setCommand((c) => ({ n: c.n + 1, type: "reset" }))}><Maximize2 /></button>
          </span>
        </div>
        <p className="key-hint">
          {three ? "Drag to orbit · shift-drag to pan" : "Drag to pan"} · scroll to zoom · click a point to inspect
          {!can3d ? " · 3D needs z coordinates from the spike" : ""}
        </p>
      </div>

      {hover && hoverPoint ? (
        <div className="hover-card glass space-hover" style={cardPos(hover)}>
          <p className="hc-text">{hoverPoint.text}</p>
          <div className="hc-meta">
            {hoverPoint.document_title ?? hoverPoint.document_external_id} · chunk {hoverPoint.ord + 1}
            {hoverPoint.token_count != null ? ` · ${hoverPoint.token_count} tokens` : ""}
            {colorField && colorField.id !== "document.title" ? ` · ${colorField.label} ${hoverValue(hoverSide && fieldsOf(hoverSide), colorId, hoverSide?.points.data?.indexOf(hoverPoint))}` : ""}
            {(() => { const h = panes[hover.pane]?.hits.find((x) => x.id === hoverPoint.chunk_id); return h ? ` · rank ${h.rank}${h.relevant ? " · relevant" : ""}` : ""; })()}
          </div>
        </div>
      ) : hover?.kind === "query" && questions.get(hover.id) ? (
        <div className="hover-card glass space-hover" style={cardPos(hover)}>
          <p className="hc-text">{questions.get(hover.id)!.question}</p>
          <div className="hc-meta">{questions.get(hover.id)!.external_id} · {questions.get(hover.id)!.qtype.replace(/_/g, " ")} · click to pick</div>
        </div>
      ) : null}

      {selectedPoint && selectedSide?.exp ? (
        <ChunkInspector
          point={selectedPoint}
          index={selectedSide.points.data!.indexOf(selectedPoint)}
          spaceId={selectedSide.exp.embedding_space_id}
          slug={selectedSide.exp.slug}
          fields={fieldsOf(selectedSide)}
          colorMark={panes[selectedPane]?.colors[selectedSide.points.data!.indexOf(selectedPoint)]}
          stats={selectedSide.stats}
          hits={selectedSide.runHits.data ?? []}
          relevantTo={(selectedSide.relevant.data ?? []).filter((r) => r.chunk_id === selectedPoint.chunk_id).map((r) => r.question_id)}
          stepIds={selectedSide.exp.step_ids}
          questions={questions}
          focusId={questionId}
          mapPoints={posOf(selectedSide)}
          byId={new Map((selectedSide.points.data ?? []).map((p) => [p.chunk_id, p]))}
          onClose={() => select(null)}
          onSelect={(id) => select(id)}
          onPickQuestion={(id) => pickQuestion(id)}
        />
      ) : fieldsOpen ? (
        <FieldsInspector fields={mainFields} corpusName={corpusName} onClose={() => set({ fields: null })}
                         colorId={colorId} setColor={(id) => set({ color: id })} />
      ) : null}
    </>
  );
}

/** The width of the page area (right of the navigation), kept up to date. */
function useStageWidth(): number {
  const [w, setW] = useState(() => document.getElementById("main")?.clientWidth ?? window.innerWidth);
  useEffect(() => {
    const el = document.getElementById("main");
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

/** A callback ref and the element's current height. */
function useHeight(): [(el: HTMLElement | null) => void, number] {
  const [h, setH] = useState(300);
  const ro = useMemo(() => new ResizeObserver(([e]) => setH(Math.round(e.contentRect.height))), []);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.disconnect();
    if (el) ro.observe(el);
  }, [ro]);
  return [ref, h];
}

function toPane(points: { chunk_id: number; x: number; y: number; z: number | null }[] | undefined, three: boolean): PanePoint[] {
  if (!points) return [];
  const n = normalise(points, three);
  return points.map((p, i) => ({ id: p.chunk_id, ...n[i] }));
}

/** Query points, in the same normalised frame as the side's chunks (so the chunks never move for them). */
function toQuery(s: Side, three: boolean) {
  const pts = s.points.data ?? [];
  const place = pts.length ? frame(pts, three) : null;
  const all = place ? (s.queries.data ?? []).map((q) => ({ id: q.question_id, label: q.external_id, ...place(q) })) : [];
  return { all, byId: new Map(all.map((q) => [q.id, q])) };
}

/** The same transform normalise() applies to these points, for other points. */
function frame(rows: { x: number; y: number; z: number | null }[], three: boolean) {
  const mean = (k: "x" | "y" | "z") => rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length;
  const mx = mean("x"), my = mean("y"), mz = three ? mean("z") : 0;
  let m = 1e-9;
  for (const r of rows) m = Math.max(m, Math.abs(r.x - mx), Math.abs(r.y - my), three ? Math.abs((r.z ?? 0) - mz) : 0);
  return (r: { x: number; y: number; z: number | null }) => ({ x: (r.x - mx) / m, y: (r.y - my) / m, z: three ? ((r.z ?? 0) - mz) / m : 0 });
}

/** The same chunk in the other pane, or, when the chunk sets differ, its document's chunks there. */
function linkTo(points: { chunk_id: number; document_id: number }[], chunkId: number, documentId: number): Set<number> | null {
  if (points.some((p) => p.chunk_id === chunkId)) return new Set([chunkId]);
  const same = points.filter((p) => p.document_id === documentId).map((p) => p.chunk_id);
  return same.length ? new Set(same) : null;
}

function useNeighbourIds(spaceId: number | undefined, chunkId: number | null): number[] {
  const n = useNeighbours(spaceId, chunkId ?? undefined);
  return useMemo(() => (n.data ?? []).map((x) => x.neighbour_id), [n.data]);
}

function hoverValue(fields: Field[] | undefined, id: string | undefined, index: number | undefined): string {
  const f = fields?.find((x) => x.id === id);
  if (!f || index == null || index < 0) return "—";
  return formatFieldValue(f.values[index], f.kind);
}

function cardPos(t: Target): React.CSSProperties {
  return { left: Math.min(t.clientX + 16, window.innerWidth - 336), top: Math.max(8, Math.min(t.clientY - 20, window.innerHeight - 140)) };
}

/** Inline legend for the colour: mark + value + count (click to keep only that value), or a ramp. */
function Legend({ scale, field, shown, filters, setFilters }: {
  scale: Scale | undefined;
  field: Field | undefined;
  shown: Field | undefined;     // the same field on the side in the first pane: its counts are the ones on screen
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  if (!scale || !field) return null;
  if (scale.kind === "category") {
    const f = filters[field.id];
    const on = f?.kind === "in" ? f.values : [];
    const toggle = (v: string) => {
      const values = on.includes(v) ? on.filter((x) => x !== v) : [...on, v];
      const next = { ...filters };
      if (values.length) next[field.id] = { kind: "in", values }; else delete next[field.id];
      setFilters(next);
    };
    const count = new Map((shown ?? field).categories.map((c) => [c.value, c.count]));
    const coloured = new Set(scale.categories.map((c) => c.value));
    const other = (shown ?? field).categories.filter((c) => !coloured.has(c.value)).reduce((n, c) => n + c.count, 0);
    const f2 = shown ?? field;
    return (
      <ul className="space-legend" aria-label={`Colours by ${field.label}`}>
        {scale.categories.filter((c) => count.has(c.value)).map((c) => (
          <li key={c.value}>
            <button type="button" aria-pressed={on.includes(c.value)} onClick={() => toggle(c.value)} title="Show only this value (click again to undo)">
              <i className="mark" style={{ background: `var(${c.token})` }} /> {c.value} <span className="muted">{count.get(c.value)}</span>
            </button>
          </li>
        ))}
        {other ? <li className="muted"><i className="mark" style={{ background: "var(--ink-3)" }} /> other <span>{other}</span></li> : null}
        {f2.present < f2.values.length ? <li className="muted"><i className="mark none" /> none <span>{f2.values.length - f2.present}</span></li> : null}
      </ul>
    );
  }
  if (scale.kind === "number" || scale.kind === "date") {
    return (
      <div className="space-ramp" aria-label={`${field.label}, low to high`}>
        <span className="muted">{formatFieldValue(scale.min, field.kind)}</span>
        <span className="ramp" />
        <span className="muted">{formatFieldValue(scale.max, field.kind)}</span>
        <span className="label">{field.label}</span>
      </div>
    );
  }
  return null;
}
