import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, rpc } from "./client";
import type {
  ConfigDiffRow, DefaultModel, EvalQuestion, Experiment, ExperimentDetail, JsonObject, LogEvent, LogSummary, MetricDef,
  FieldStyle, Neighbour, Provider, ProviderUsage, QueryPoint, QuestionResult, RetrievalHit, Run, RunEvent, RunHit, RunMetric,
  RunProgress, SpaceMethod, SpacePoint, StepDef, StepSummary,
} from "./types";

// Everything versioned is immutable, so most data can be cached for a long time.
// Only run progress and the experiment list (new runs, pins) refresh on their own.

export function useExperiments() {
  return useQuery({
    queryKey: ["experiments"],
    queryFn: () => get<Experiment[]>("experiments?order=ord"),
    refetchInterval: 15_000,
  });
}

export function useMetricDefs() {
  return useQuery({
    queryKey: ["metric_defs"],
    queryFn: () => get<MetricDef[]>("metric_defs?order=sort"),
    staleTime: Infinity,
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => get<Provider[]>("providers?order=location,id"),
    staleTime: 30_000,
  });
}

export function useProviderUsage() {
  return useQuery({
    queryKey: ["provider_usage"],
    queryFn: () => get<ProviderUsage[]>("provider_usage"),
    staleTime: 30_000,
  });
}

export function useDefaultModels() {
  return useQuery({
    queryKey: ["default_models"],
    queryFn: () => get<DefaultModel[]>("default_models?order=sort,kind"),
    staleTime: 30_000,
  });
}

export function useStepDefs() {
  return useQuery({
    queryKey: ["step_defs"],
    queryFn: () => get<StepDef[]>("step_defs?order=sort"),
    staleTime: Infinity,
  });
}

function useProviderWrite<A extends Record<string, unknown>>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => rpc(fn, args),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["default_models"] });
    },
  });
}

export const useSetProviderEnabled = () => useProviderWrite<{ provider_id: string; enabled: boolean }>("set_provider_enabled");
export const useSetProviderCap = () => useProviderWrite<{ provider_id: string; cap_usd: number | null }>("set_provider_cap");

export function useExperimentDetail(id: number | undefined) {
  return useQuery({
    queryKey: ["experiment_detail", id],
    queryFn: () => get<ExperimentDetail[]>(`experiment_detail?id=eq.${id}`).then((r) => r[0]),
    enabled: id != null,
  });
}

/** A version's steps in pipeline order: the library's fixed steps, then its own. */
export function useStepSummary(id: number | undefined) {
  return useQuery({
    queryKey: ["step_summary", id],
    queryFn: () => get<StepSummary[]>(`step_summary?experiment_id=eq.${id}&order=ord`),
    enabled: id != null,
    staleTime: 60_000,
  });
}

/** Only the config fields that differ: a = reference, b = the version being looked at. */
export function useConfigDiff(a: number | undefined, b: number | undefined) {
  return useQuery({
    queryKey: ["config_diff", a, b],
    queryFn: () => get<ConfigDiffRow[]>(`rpc/config_diff?a=${a}&b=${b}`),
    enabled: a != null && b != null,
    staleTime: Infinity,
  });
}

export function useQuestionResults(id: number | undefined) {
  return useQuery({
    queryKey: ["question_results", id],
    queryFn: () => get<QuestionResult[]>(`question_results?experiment_id=eq.${id}&order=external_id`),
    enabled: id != null,
    staleTime: 60_000,
  });
}

/** Every retrieved chunk for one question in one run, all stages. */
export function useRetrievalHits(runId: number | undefined, questionId: number | undefined) {
  return useQuery({
    queryKey: ["retrieval_hits", runId, questionId],
    queryFn: () => get<RetrievalHit[]>(`retrieval_hits?run_id=eq.${runId}&question_id=eq.${questionId}&order=stage,rank`),
    enabled: runId != null && questionId != null,
    staleTime: Infinity,
  });
}

export function useEvalQuestion(id: number | undefined) {
  return useQuery({
    queryKey: ["eval_question", id],
    queryFn: () => get<EvalQuestion[]>(`eval_questions?id=eq.${id}`).then((r) => r[0]),
    enabled: id != null,
    staleTime: Infinity,
  });
}

/** The projections a space has (umap, pca, ...), and whether each is 3D and clustered. */
export function useSpaceMethods(spaceId: number | undefined) {
  return useQuery({
    queryKey: ["space_methods", spaceId],
    queryFn: () => get<SpaceMethod[]>(`space_methods?space_id=eq.${spaceId}&order=method`),
    enabled: spaceId != null,
    staleTime: 60_000,
  });
}

/** One projection of every chunk in an embedding space, with the chunk's and document's fields. */
export function useSpacePoints(spaceId: number | undefined, method: string | undefined) {
  return useQuery({
    queryKey: ["space_points", spaceId, method],
    queryFn: () => get<SpacePoint[]>(`space_points?space_id=eq.${spaceId}&method=eq.${encodeURIComponent(method!)}&order=chunk_id`),
    enabled: spaceId != null && method != null,
    staleTime: Infinity,
  });
}

/** Where each question lands in the same space. */
export function useQueryPoints(spaceId: number | undefined, method: string | undefined) {
  return useQuery({
    queryKey: ["query_points", spaceId, method],
    queryFn: () => get<QueryPoint[]>(`query_points?space_id=eq.${spaceId}&method=eq.${encodeURIComponent(method!)}`),
    enabled: spaceId != null && method != null,
    staleTime: Infinity,
  });
}

/** Every ranked list of a run (all questions, all steps), without text. */
export function useRunHits(runId: number | undefined) {
  return useQuery({
    queryKey: ["run_hits", runId],
    queryFn: () => get<RunHit[]>(`run_hits?run_id=eq.${runId}`),
    enabled: runId != null,
    staleTime: Infinity,
  });
}

/** Every (question, chunk) pair where the chunk overlaps the question's gold evidence. */
export function useRelevantPairs(chunkSetId: number | undefined) {
  return useQuery({
    queryKey: ["relevant_pairs", chunkSetId],
    queryFn: () => get<{ question_id: number; chunk_id: number }[]>(`relevant_chunks?chunk_set_id=eq.${chunkSetId}&select=question_id,chunk_id`),
    enabled: chunkSetId != null,
    staleTime: Infinity,
  });
}

/** The real nearest neighbours of a chunk, from its vectors. */
export function useNeighbours(spaceId: number | undefined, chunkId: number | undefined, k = 10) {
  return useQuery({
    queryKey: ["neighbours", spaceId, chunkId, k],
    queryFn: () => get<Neighbour[]>(`rpc/chunk_neighbours?space_id=${spaceId}&chunk_id=${chunkId}&k=${k}`),
    enabled: spaceId != null && chunkId != null,
    staleTime: Infinity,
  });
}

export function useFieldStyles(corpusName: string | undefined) {
  return useQuery({
    queryKey: ["field_styles", corpusName],
    queryFn: () => get<FieldStyle[]>(`field_styles?corpus_name=eq.${encodeURIComponent(corpusName!)}`),
    enabled: corpusName != null,
    staleTime: 60_000,
  });
}

/** style = {label, kind, hidden, colors}; keys left out are kept, null clears, {} resets the field. */
export function useSetFieldStyle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { corpus_name: string; field: string; style: JsonObject }) => rpc("set_field_style", args),
    onSettled: (_d, _e, args) => qc.invalidateQueries({ queryKey: ["field_styles", args.corpus_name] }),
  });
}

/** Chunks that overlap a question's gold evidence, in one chunk set. */
export function useRelevantChunks(chunkSetId: number | undefined, questionId: number | undefined) {
  return useQuery({
    queryKey: ["relevant_chunks", chunkSetId, questionId],
    queryFn: () =>
      get<{ chunk_id: number }[]>(`relevant_chunks?chunk_set_id=eq.${chunkSetId}&question_id=eq.${questionId}&select=chunk_id`)
        .then((rows) => new Set(rows.map((r) => r.chunk_id))),
    enabled: chunkSetId != null && questionId != null,
    staleTime: Infinity,
  });
}

const isOpen = (status: string | undefined) => status === "queued" || status === "running";

/** All runs, newest first. Polls while any run is still open. */
export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: () => get<Run[]>("runs?order=queued_at.desc,id.desc"),
    refetchInterval: (q) => (q.state.data?.some((r) => isOpen(r.status)) ? 5_000 : 30_000),
  });
}

export function useRunProgress(runId: number | undefined, status?: string) {
  return useQuery({
    queryKey: ["run_progress", runId],
    queryFn: () => get<RunProgress[]>(`run_progress?run_id=eq.${runId}`).then((r) => r[0] ?? null),
    enabled: runId != null,
    refetchInterval: isOpen(status) ? 3_000 : false,
  });
}

export function useRunMetrics(runId: number | undefined) {
  return useQuery({
    queryKey: ["run_metrics", runId],
    queryFn: () => get<RunMetric[]>(`run_metrics?run_id=eq.${runId}&order=sort,name`),
    enabled: runId != null,
    staleTime: 30_000,
  });
}

/** Puts a run in the queue. Without a backend it stays queued. */
export function useQueueRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { experiment_id: number; overrides: JsonObject; note: string | null }) =>
      rpc<{ run_id: number; status: string }>("queue_run", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["run_progress"] });
      qc.invalidateQueries({ queryKey: ["experiments"] });
    },
  });
}

export function useLatestRun() {
  return useQuery({
    queryKey: ["run_progress", "latest"],
    queryFn: () => get<RunProgress[]>("run_progress?order=queued_at.desc&limit=1").then((r) => r[0] ?? null),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "done" && q.state.data.status !== "failed" ? 3_000 : 20_000),
  });
}

export function useRunEvents(runId: number | undefined, limit = 40) {
  return useQuery({
    queryKey: ["run_events", runId, limit],
    queryFn: () => get<RunEvent[]>(`run_events?run_id=eq.${runId}&order=ts.desc,id.desc&limit=${limit}`),
    enabled: runId != null,
    refetchInterval: 5_000,
  });
}

export function useSetBaseline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { experiment_id: number; pinned: boolean }) => rpc("set_baseline", args),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { experiment_id: number; body: string }) => rpc("add_note", args),
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ---------- the log ----------

export interface LogFilters {
  actors: string[];
  kinds: string[];
  slug: string | null;        // a version slug, "none" for events without a version, null for all
  search: string;
}

const LOG_PAGE = 100;

/** PostgREST URL for one page of the log, newest first. The cursor is the last row of the previous page. */
function logUrl(f: LogFilters, cursor?: { ts: string; id: number }): string {
  const p = new URLSearchParams({ order: "ts.desc,id.desc", limit: String(LOG_PAGE) });
  if (f.actors.length) p.set("actor", `in.(${f.actors.join(",")})`);
  if (f.kinds.length) p.set("kind", `in.(${f.kinds.join(",")})`);
  if (f.slug) p.set("slug", f.slug === "none" ? "is.null" : `eq.${f.slug}`);
  const and: string[] = [];
  // characters that mean something in PostgREST's filter syntax are dropped from the search text
  const q = f.search.replace(/[,()"*\\]/g, " ").trim();
  if (q) and.push(`or(action.ilike.*${q}*,note.ilike.*${q}*,target_id.ilike.*${q}*,slug.ilike.*${q}*)`);
  // keyset paging: strictly older than the cursor (ties on ts broken by id)
  if (cursor) and.push(`or(ts.lt."${cursor.ts}",and(ts.eq."${cursor.ts}",id.lt.${cursor.id}))`);
  if (and.length) p.set("and", `(${and.join(",")})`);
  return `log?${p.toString()}`;
}

export function useLog(f: LogFilters) {
  return useInfiniteQuery({
    queryKey: ["log", f],
    initialPageParam: undefined as { ts: string; id: number } | undefined,
    queryFn: ({ pageParam }) => get<LogEvent[]>(logUrl(f, pageParam)),
    getNextPageParam: (last) => (last.length < LOG_PAGE ? undefined : { ts: last[last.length - 1].ts, id: last[last.length - 1].id }),
    refetchInterval: 15_000,
  });
}

export function useLogSummary() {
  return useQuery({
    queryKey: ["log_summary"],
    queryFn: () => get<LogSummary[]>("log_summary"),
    refetchInterval: 15_000,
  });
}

/** One event by id, for an inspector opened from a link. */
export function useLogEvent(id: number | null) {
  return useQuery({
    queryKey: ["log_event", id],
    queryFn: () => get<LogEvent[]>(`log?id=eq.${id}`).then((r) => r[0] ?? null),
    enabled: id != null,
    staleTime: Infinity,
  });
}
