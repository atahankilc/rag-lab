// The chunk sheet: its text and fields, its rank in every step for the picked question, its true
// nearest neighbours next to its nearest points on the map, and the questions it served or missed.

import { useMemo } from "react";
import { useNeighbours } from "../api/hooks";
import type { RunHit, SpacePoint } from "../api/types";
import { Inspector, InspectorSection } from "../components/Inspector";
import { Readout } from "../components/Readout";
import { type Field, type RetrievalStats, formatFieldValue } from "../lib/fields";
import { stepRank } from "../lib/steps";
import type { PanePoint } from "./SpaceCanvas";

const K = 10;

export interface QuestionName {
  id: number;
  external_id: string;
  question: string;
}

export function ChunkInspector({
  point,
  index,
  spaceId,
  slug,
  fields,
  colorMark,
  stats,
  hits,
  relevantTo,
  stepIds,
  questions,
  focusId,
  mapPoints,
  byId,
  onClose,
  onSelect,
  onPickQuestion,
}: {
  point: SpacePoint;
  index: number; // the point's position in its side's points and fields
  spaceId: number;
  slug: string;
  fields: Field[];
  colorMark: string | undefined;
  stats: RetrievalStats | undefined;
  hits: RunHit[]; // every ranked list of the side's latest run
  relevantTo: number[]; // questions whose gold evidence this chunk overlaps
  stepIds: string[];
  questions: Map<number, QuestionName>;
  focusId: number | null;
  mapPoints: PanePoint[]; // the positions on screen (normalised), to compare with the vectors
  byId: Map<number, SpacePoint>;
  onClose: () => void;
  onSelect: (id: number) => void;
  onPickQuestion: (id: number) => void;
}) {
  const neighbours = useNeighbours(spaceId, point.chunk_id, K);

  // the K nearest points on the map, by distance in the current (2D or 3D) layout
  const mapRank = useMemo(() => {
    const me = mapPoints.find((p) => p.id === point.chunk_id);
    if (!me) return new Map<number, number>();
    const d = mapPoints
      .filter((p) => p.id !== me.id)
      .map((p) => ({ id: p.id, d: (p.x - me.x) ** 2 + (p.y - me.y) ** 2 + (p.z - me.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    return new Map(d.map((x, i) => [x.id, i + 1]));
  }, [mapPoints, point.chunk_id]);
  const alsoNear = (neighbours.data ?? []).filter((n) => (mapRank.get(n.neighbour_id) ?? Infinity) <= K).length;

  const mine = hits.filter((h) => h.chunk_id === point.chunk_id);
  const final = stats?.stage;
  const served = mine.filter((h) => h.stage === final).sort((a, b) => a.rank - b.rank || a.question_id - b.question_id);
  const servedIds = new Set(served.map((h) => h.question_id));
  const answered = new Set(hits.map((h) => h.question_id));
  const missedBy = relevantTo.filter((q) => answered.has(q) && !servedIds.has(q));
  const focusRows =
    focusId != null
      ? mine
          .filter((h) => h.question_id === focusId)
          .sort((a, b) => stepRank(stepIds, a.stage) - stepRank(stepIds, b.stage))
      : [];
  const focusStages =
    focusId != null
      ? [...new Set(hits.filter((h) => h.question_id === focusId).map((h) => h.stage))].sort(
          (a, b) => stepRank(stepIds, a) - stepRank(stepIds, b),
        )
      : [];
  const shownFields = fields.filter((f) => !f.hidden && f.values[index] != null && f.id !== "document.title");

  return (
    <Inspector
      open
      onClose={onClose}
      label={`Chunk ${point.chunk_id}`}
      layer={`Chunk ${point.ord + 1} of its document · ${slug}`}
      layerMark={colorMark ? <i className="mark" style={{ background: colorMark }} /> : <i className="mark held" />}
      what={point.document_external_id}
      title={point.document_title ?? point.document_external_id}
      figure={
        <>
          <Readout label="Tokens" size={34} value={point.token_count != null ? String(point.token_count) : "—"} />
          <Readout
            label="Retrieved by"
            size={34}
            value={stats ? String(stats.retrieved.get(point.chunk_id) ?? 0) : "—"}
            unit={stats?.retrieved.get(point.chunk_id) === 1 ? "question" : "questions"}
          />
          <Readout
            label="Relevant to"
            size={34}
            value={stats ? String(stats.relevant.get(point.chunk_id) ?? 0) : "—"}
            unit={stats?.relevant.get(point.chunk_id) === 1 ? "question" : "questions"}
          />
        </>
      }
    >
      <InspectorSection title="Text" count={`chars ${point.char_start}–${point.char_end}`}>
        <p className="chunk-text">{point.text}</p>
      </InspectorSection>

      {focusId != null ? (
        <InspectorSection title="For the picked question" count={questions.get(focusId)?.external_id}>
          {focusStages.length ? (
            focusStages.map((s) => {
              const h = focusRows.find((r) => r.stage === s);
              return (
                <div key={s} className="kv-row">
                  <span className="k">
                    {s}
                    {s === final ? " · final" : ""}
                  </span>
                  <span className="v">
                    {h ? (
                      `#${h.rank}${h.score != null ? ` · ${h.score.toFixed(3)}` : ""}`
                    ) : (
                      <span className="muted">not in the list</span>
                    )}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="muted">This version has no lists for that question.</p>
          )}
        </InspectorSection>
      ) : null}

      <InspectorSection
        title="True neighbours"
        count={neighbours.data?.length ? `${alsoNear} of ${neighbours.data.length} also near on the map` : undefined}
      >
        {neighbours.isLoading ? (
          <p className="muted">Searching the vectors…</p>
        ) : neighbours.error ? (
          <p className="muted">No vectors to search: {(neighbours.error as Error).message}</p>
        ) : !neighbours.data?.length ? (
          <p className="muted">This chunk has no vector yet.</p>
        ) : (
          <>
            <p className="label">
              Nearest by cosine similarity of the real vectors (what dense retrieval sees), and where each sits among
              the nearest points on the map.
            </p>
            <ul className="nb-list">
              {neighbours.data.map((n) => {
                const p = byId.get(n.neighbour_id);
                const r = mapRank.get(n.neighbour_id);
                return (
                  <li key={n.neighbour_id}>
                    <button type="button" className="nb-row" onClick={() => onSelect(n.neighbour_id)}>
                      <span className="nb-rank">{n.rank}</span>
                      <span className="nb-main">
                        <span className="nb-title">
                          {p?.document_title ?? p?.document_external_id ?? `chunk ${n.neighbour_id}`}
                        </span>
                        <span className="nb-text">{p?.text}</span>
                      </span>
                      <span className="nb-num">
                        <span className="t-val">{(1 - n.distance).toFixed(3)}</span>
                        <span className={`t-meta ${r != null && r > K ? "far" : ""}`}>
                          {r != null ? `map #${r}` : "not on map"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </InspectorSection>

      <InspectorSection title="Questions it served" count={stats ? `${served.length} · ${final ?? ""}` : undefined}>
        {!stats ? (
          <p className="muted">This version has no finished run yet.</p>
        ) : served.length === 0 ? (
          <p className="muted">No question's final context included it.</p>
        ) : (
          <ul className="served">
            {served.map((h) => {
              const q = questions.get(h.question_id);
              return (
                <li key={h.question_id}>
                  <button type="button" className="served-row" onClick={() => onPickQuestion(h.question_id)}>
                    <i
                      className={relevantTo.includes(h.question_id) ? "mark held" : "mark new"}
                      aria-label={relevantTo.includes(h.question_id) ? "relevant" : "not relevant"}
                    />
                    <span className="t-id">{q?.external_id ?? h.question_id}</span>
                    <span className="served-q">{q?.question}</span>
                    <span className="muted">#{h.rank}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </InspectorSection>

      {missedBy.length ? (
        <InspectorSection title="Relevant, but not retrieved" count={missedBy.length}>
          <ul className="served">
            {missedBy.map((id) => {
              const q = questions.get(id);
              return (
                <li key={id}>
                  <button type="button" className="served-row" onClick={() => onPickQuestion(id)}>
                    <i className="mark lost" aria-label="missed" />
                    <span className="t-id">{q?.external_id ?? id}</span>
                    <span className="served-q">{q?.question}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </InspectorSection>
      ) : null}

      {shownFields.length ? (
        <InspectorSection title="Fields">
          {shownFields.map((f) => (
            <div key={f.id} className="kv-row">
              <span className="k">{f.label}</span>
              <span className="v">{formatFieldValue(f.values[index], f.kind)}</span>
            </div>
          ))}
        </InspectorSection>
      ) : null}
    </Inspector>
  );
}
