// Row shapes of the `api` views (see viz/db/migrations/*_api_read.sql).
// Configs and metrics stay open-ended (Json / Record) on purpose: a new knob or metric
// from a future spike must render without a code change.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Metrics = Record<string, number>;

export interface Experiment {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  parent_slug: string | null;
  note: string | null;
  status: "active" | "archived";
  is_baseline: boolean;
  created_at: string;
  ord: number;
  corpus_version_id: number;
  /** null for a version without chunks (closed-book) */
  chunk_set_id: number | null;
  /** null for a version without vectors (closed-book, lexical only) */
  embedding_space_id: number | null;
  eval_set_id: number;
  chunk_set_name: string | null;
  embedding_model: string | null;
  embedding_location: "local" | "cloud" | null;
  step_ids: string[];
  latest_run_id: number | null;
  last_run_id: number | null;
  last_run_status: RunStatus | null;
  metrics: Metrics;
  diff_count: number;
  changed_keys: string[];
  note_count: number;
}

export interface ExperimentDetail {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  note: string | null;
  status: string;
  is_baseline: boolean;
  created_at: string;
  config_hash: string;
  pipeline_config: JsonObject;
  config: JsonObject;
  corpus: { id: number; name: string; hash: string; manifest: JsonObject; documents: number };
  chunk_set: { id: number; name: string; config: JsonObject; hash: string; chunks: number } | null;
  embedding_space: {
    id: number;
    provider: string;
    model: string;
    dim: number;
    location: "local" | "cloud";
    config: JsonObject;
    table: string | null;
    build_stats: JsonObject | null;
    hash: string;
  } | null;
  eval_set: { id: number; name: string; version: string; questions: number };
  notes: { id: number; body: string; actor: string; created_at: string }[];
  latest_run_id: number | null;
  metrics: { name: string; scope: string; value: number }[];
}

/** One row of api.step_summary: the library's fixed steps, then the version's own steps, in order. */
export interface StepSummary {
  experiment_id: number;
  slug: string;
  ord: number;
  step_id: string;
  kind: string;
  phase: "index" | "query";
  kind_label: string;
  description: string;
  /** which config_diff paths belong to this step: "chunking", "steps.rerank", ... */
  diff_prefix: string;
  config: JsonObject | null;
  item_count: number | null;
  provider_id: string | null;
  location: "local" | "cloud" | null;
  p50_ms: number | null;
  p95_ms: number | null;
  cost_usd: number | null;
  cost_per_query_usd: number | null;
  run_id: number | null;
}

export interface StepDef {
  kind: string;
  phase: "index" | "query";
  label: string;
  description: string;
  sort: number;
}

export interface ConfigDiffRow {
  path: string;
  a_value: Json;
  b_value: Json;
}

export interface MetricDef {
  name: string;
  label: string;
  grp: "retrieval" | "generation" | "ops";
  unit: string | null;
  higher_is_better: boolean;
  format: string;
  is_primary: boolean;
  sort: number;
  description: string | null;
}

export type Verdict = "better" | "worse" | "unchanged";

export interface QuestionResult {
  experiment_id: number;
  slug: string;
  run_id: number;
  question_id: number;
  external_id: string;
  qtype: string;
  tags: string[];
  question: string;
  gold_answer: string | null;
  answer: string | null;
  citations: { marker: string; chunk_id: number; rank: number }[];
  metrics: Metrics;
  latency_ms: Record<string, number>;
  /** per step id: {"in": n, "out": n}; runs stored before that kept one flat {"prompt", "completion"} */
  tokens: Record<string, number | { in?: number; out?: number }>;
  /** per step id, in USD */
  cost: Record<string, number>;
  cost_usd: number | null;
  judge_rationale: string | null;
  latency_total_ms: number | null;
  primary_metric: string;
  score: number | null;
  parent_metrics: Metrics | null;
  parent_score: number | null;
  delta_parent: number | null;
  baseline_metrics: Metrics | null;
  baseline_score: number | null;
  delta_baseline: number | null;
  verdict_parent: Verdict | null;
  verdict_baseline: Verdict | null;
}

export type RunStatus = "queued" | "running" | "done" | "failed";

export interface RunStage {
  stage: string;
  kind: string;
  label: string;
  state: "pending" | "start" | "running" | "progress" | "done" | "failed";
  done: number | null;
  total: number | null;
  level: string | null;
  message: string | null;
  ts: string | null;
}

export interface RunProgress {
  run_id: number;
  experiment_id: number;
  slug: string;
  status: RunStatus;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  overrides: JsonObject;
  stages: RunStage[];
}

export interface RunEvent {
  id: number;
  run_id: number;
  ts: string;
  stage: string | null;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data: JsonObject;
}

export interface ProviderModel {
  name: string;
  kinds?: string[];
  dim?: number;
  price_in_per_1m?: number;
  price_out_per_1m?: number;
}

export interface Provider {
  id: string;
  name: string;
  kind: string;
  location: "local" | "cloud";
  endpoint: string | null;
  key_env: string | null;
  models: ProviderModel[];
  enabled: boolean;
  spend_cap_usd: number | null;
  created_at: string;
  spent_usd: number;
  queries: number;
  default_kinds: string[] | null;
}

/** The id of the step that produced a ranked list (any step id). */
export type HitStage = string;

export interface RetrievalHit {
  run_id: number;
  experiment_id: number;
  question_id: number;
  stage: HitStage;
  rank: number;
  score: number | null;
  chunk_id: number;
  document_id: number;
  document_title: string | null;
  source: string | null;
  chunk_ord: number;
  token_count: number | null;
  text: string;
  relevant: boolean;
  char_start: number;
  char_end: number;
}

export interface Evidence {
  document_id: number;
  document_title: string | null;
  char_start: number;
  char_end: number;
  text: string;
}

export interface EvalQuestion {
  id: number;
  eval_set_id: number;
  external_id: string;
  qtype: string;
  tags: string[];
  source_types: string[];
  question: string;
  gold_answer: string | null;
  answer_facts: Json[];
  evidence: Evidence[];
}

export interface SpacePoint {
  space_id: number;
  method: string;
  chunk_id: number;
  x: number;
  y: number;
  z: number | null;
  chunk_set_id: number;
  document_id: number;
  ord: number;
  char_start: number;
  char_end: number;
  token_count: number | null;
  text: string;
  doc_index: number;
  document_title: string | null;
  source: string | null;
  project: string | null;
  document_external_id: string;
  author: string | null;
  doc_date: string | null;
  document_metadata: JsonObject;
  chunk_metadata: JsonObject;
  cluster: number | null;
}

/** One projection of an embedding space (api.space_methods). */
export interface SpaceMethod {
  space_id: number;
  method: string;
  points: number;
  has_z: boolean;
  has_clusters: boolean;
  params: JsonObject | null;
}

/** A ranked list entry without text (api.run_hits). */
export interface RunHit {
  run_id: number;
  question_id: number;
  stage: HitStage;
  rank: number;
  chunk_id: number;
  score: number | null;
}

export type FieldKind = "category" | "number" | "date" | "text";

/** How the UI shows a field, saved per corpus name (api.field_styles). */
export interface FieldStyle {
  corpus_name: string;
  field: string;
  label: string | null;
  kind: FieldKind | null;
  hidden: boolean;
  colors: Record<string, string>;
  updated_at: string;
}

/** A true nearest neighbour by cosine distance (api.chunk_neighbours). */
export interface Neighbour {
  neighbour_id: number;
  rank: number;
  distance: number;
}

export interface QueryPoint {
  space_id: number;
  method: string;
  question_id: number;
  x: number;
  y: number;
  z: number | null;
  external_id: string;
  qtype: string;
  question: string;
}

export interface Run {
  id: number;
  experiment_id: number;
  slug: string;
  experiment_name: string;
  status: RunStatus;
  overrides: JsonObject;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  total_cost_usd: number | null;
  stage_cost: Record<string, number>;
  git_commit: string | null;
  environment: JsonObject;
  worker: string | null;
  error: string | null;
  results: number;
  questions: number;
  events: number;
}

export interface RunMetric {
  run_id: number;
  name: string;
  scope: string;
  value: number;
  label: string;
  format: string;
  higher_is_better: boolean;
  sort: number;
}

export interface ProviderUsage {
  provider_id: string;
  experiment_id: number;
  slug: string;
  name: string;
  step_ids: string[];
  spent_usd: number;
}

export interface DefaultModel {
  kind: string;
  kind_label: string;
  sort: number;
  provider_id: string;
  model: string;
  location: "local" | "cloud";
  enabled: boolean;
}

export interface LogEvent {
  id: number;
  ts: string;
  actor: "me" | "system" | "model";
  action: string;
  target_type: string | null;
  target_id: string | null;
  experiment_id: number | null;
  slug: string | null;
  before: JsonObject | null;
  after: JsonObject | null;
  note: string | null;
  kind: string;
}

export interface LogSummary {
  kind: string;
  actor: LogEvent["actor"];
  slug: string | null;
  n: number;
  last_ts: string;
}
