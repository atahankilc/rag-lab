# Backend contract: how a RAG spike shows up in RAG Lab

RAG Lab doesn't run RAG. A **spike** (a script in `../rag/`, in any language) does the work and writes what
it did into the database. If it follows the seven steps below, it appears on every page of the UI with no
frontend change, whatever its pipeline looks like.

All of it is proven by `make test-contract`, which runs every step as the backend role and rolls back.
[`db/tests/contract.sql`](../db/tests/contract.sql) is the executable version of this document.

---

## Connecting

| | |
|---|---|
| Role | `lab_backend` (created on first start from `LAB_BACKEND_PASSWORD` in `.env`) |
| URL | `postgresql://lab_backend:<LAB_BACKEND_PASSWORD>@127.0.0.1:54329/lab` |
| Tables | schema `lab` |
| Can | `SELECT` everything in `lab` and `api`; `INSERT` artifacts, versions, runs, results, events; move its own runs forward |
| Can't | `DELETE` anything, `UPDATE` anything except a run's progress fields and an embedding space's `build_stats` (once), or change providers |

A spike talks to Postgres directly, not through PostgREST. In Python that would be, for example, `psycopg`
plus the `pgvector` package for vector columns. Pick that when you build the first spike.

## Providers and keys

Providers (OpenAI, Ollama, sentence-transformers, later maybe Anthropic) are configuration in
[`viz/providers.json`](../providers.json), loaded with `make providers`. Each one has an `id`, a `location`
(`local` / `cloud`), its models, and `key_env`, the name of the `.env` variable that holds its API key.

**API keys never go in the database.** Before calling a provider, a spike reads its row:

```sql
select enabled, spend_cap_usd, key_env, models from lab.provider where id = 'openai';
select spent_usd from api.providers where id = 'openai';      -- all-time spend, to compare with the cap
```

It calls the provider only if `enabled` is true and spend is under the cap. It gets the key from the environment
variable named in `key_env`. When a step doesn't name a model, it uses the default for its kind:

```sql
select provider_id, model from lab.default_model where kind = 'rerank';
```

## The model in one picture

```
THE LIBRARY: built once, shared by every version that does the same work (fixed shape)
corpus_version ─< document
     └─< chunk_set ─< chunk
            └─< embedding_space → lab.emb_<id> (vectors) + projection (2D points)
eval_set ─< eval_question ─< gold_evidence (document + char span)

THE VERSION: the library + its own steps, in order (fully configurable)
experiment { library ids, config.steps: [ {id, kind, ...}, {id, kind, ...}, ... ], parent_id }
     └─< run ─< run_event, question_result, retrieval_hit, run_metric
```

**The library has a fixed shape on purpose:** documents → chunks → vectors. These are stored once, shared by
every version that does the same work, and other things point at individual chunks (retrieved chunk #1234, the
Space map). *How* they're made is free configuration: chunking strategy and sizes, embedding model,
local or cloud.

**The steps per question are fully configurable:** any steps, any kinds, in any order, declared by the version.

**Content addressing.** Every artifact has a `config_hash` = sha256 of its parent's id + its normalised config.
Normalising drops `null` keys, and Postgres `jsonb` already ignores key order and whitespace, so
`{"size": 512, "overlap": 0}` and `{"overlap": 0, "size": 512, "x": null}` are the same chunking. Send integers
as integers: `512` and `512.0` hash differently. The `ensure_*` functions compute the hash for you.
A version's hash includes its steps **in order**, so reordering steps makes a new version.

**Immutability.** Once written, artifacts and results never change. A new chunking is a new chunk set, and a
new pipeline is a new version with `parent_id`. Every insert and status change is logged to `lab.log_event`
automatically.

---

## Step 1: find or create the library

Each call returns the id of the existing row when the same work is already there, so re-running a spike is
cheap and never duplicates anything.

```sql
-- the corpus: content_hash = sha256 over the sorted per-document content hashes
select lab.ensure_corpus_version(:name, :content_hash, :manifest_jsonb);            -- -> corpus_version_id

-- documents (only when the corpus is new; skip if they're already there)
insert into lab.document (corpus_version_id, external_id, source, title, author, project, doc_date, metadata, text, content_hash)
values (...)
on conflict (corpus_version_id, external_id) do nothing;

-- one chunking config applied to that corpus
select lab.ensure_chunk_set(:corpus_version_id, :name, :config_jsonb);              -- -> chunk_set_id
--   config e.g. {"strategy": "recursive", "size": 400, "overlap": 50, "unit": "tokens"}

-- chunks (only when the chunk set is new); metadata is optional: anything that describes the chunk
insert into lab.chunk (chunk_set_id, document_id, ord, char_start, char_end, token_count, parent_chunk_id, text, metadata)
values (...)
on conflict (chunk_set_id, document_id, ord) do nothing;

-- the eval set: content_hash over the questions; then questions and gold evidence when it is new
select lab.ensure_eval_set(:name, :version, :content_hash, :description);           -- -> eval_set_id
insert into lab.eval_question (eval_set_id, external_id, qtype, tags, source_types, question, gold_answer, answer_facts)
values (...) on conflict (eval_set_id, external_id) do nothing;
insert into lab.gold_evidence (question_id, document_id, char_start, char_end) values (...);

-- an embedding space: chunk set × model. Creates lab.emb_<id> with vector(dim) + an HNSW index.
select lab.create_embedding_space(:chunk_set_id, :provider_id, :model, :dim, :location, :config_jsonb);
--   provider_id must be a provider from providers.json; location is 'local' or 'cloud'
select table_name from lab.embedding_space where id = :embedding_space_id;          -- e.g. 'lab.emb_7'
```

**Describe the data with metadata, whatever it is.** `source`, `title`, `author`, `project` and `doc_date` are
optional columns; anything else goes in `document.metadata` (and per chunk in `chunk.metadata`) as plain JSON:

| Data | document.metadata | chunk.metadata |
|---|---|---|
| Jira ticket | `{"issue_type": "bug", "priority": 2, "status": "done"}` | `{"section": "comments"}` |
| GitHub PR | `{"repo": "api", "state": "merged", "files_changed": 12}` | `{"file": "src/auth.py"}` |
| Spreadsheet | `{"sheet": "Q3", "owner": {"team": "finance"}}` | `{"row": 120}` |

The Space page finds every key, detects whether it is a category, number, date or free text, and offers it for
colour, filters and the chunk inspector. Nested objects become dotted names (`owner.team`). Use JSON numbers for
numbers and ISO dates (`2026-03-14`) for dates. No migration and no frontend change are needed for new keys.

**Gold evidence is a span, not a chunk id.** That's what lets one eval set score every chunking: a chunk counts
as relevant when it overlaps a gold span (`chunk.char_start < gold.char_end and gold.char_start < chunk.char_end`).
For EnterpriseRAG-Bench, a gold document with no finer location can use the whole document as its span.

*In the UI:* nothing yet. The library appears once a version uses it.

## Step 2: vectors and projections

Skip this when step 1 reused an existing embedding space whose `build_stats` is already set.

```sql
insert into lab.emb_7 (chunk_id, embedding) values (:chunk_id, :vector);   -- '[0.12, -0.03, ...]'::vector
-- set once, after all vectors are in:
update lab.embedding_space
set build_stats = '{"vectors": 237, "build_ms": 5400, "index_bytes": 1830000, "embed_tokens": 81000, "embed_cost_usd": 0.0016}'
where id = :embedding_space_id;

-- coordinates for the Space page, e.g. UMAP over the vectors; z (3D) and cluster are optional
insert into lab.projection (space_id, method, chunk_id, x, y, z, params, cluster)
values (:space_id, 'umap', :chunk_id, :x, :y, :z, '{"n_neighbors": 15, "min_dist": 0.1}', :cluster);
-- where each question lands, with the same projection (umap.transform on the query vectors)
insert into lab.query_projection (space_id, method, question_id, x, y, z) values (...);
```

Models with more than 2000 dimensions are stored as `halfvec`; the insert looks the same.

**What the Space page can show, and what it needs:**

| Feature | Write |
|---|---|
| The map | one `method` (e.g. `umap`) with `x`, `y` for every chunk |
| A switch between projections | more methods for the same space (`umap`, `pca`, `tsne`, ...), each for every chunk |
| 3D | `z` for every chunk of a method (and for its query points); without it 3D is disabled |
| Colour by cluster | `cluster` per chunk (e.g. HDBSCAN on the vectors; `-1` = noise) |
| Questions on the map | `query_projection` for the same space and method |
| True nearest neighbours | nothing extra: the page asks `api.chunk_neighbours(space_id, chunk_id, k)`, a cosine search over `lab.emb_<id>` |
| Retrieval colours, chunk inspector | nothing extra: they come from `retrieval_hit` and the gold spans (step 6) |

The page shows only what is there and says when something is missing.

*In the UI:* `build_stats` fills the library's Embed step; projections draw the Space page.

## Step 3: the version and its steps

```sql
select lab.ensure_experiment(
  :slug, :name, :parent_id, :note,               -- note = why you tried this; it is the timeline's hover text
  :corpus_version_id, :chunk_set_id, :embedding_space_id, :eval_set_id,
  :config_jsonb);                                -- -> experiment_id
```

If a version with exactly this library and this config already exists, you get its id back, whatever its slug.
A new config with a slug that's already taken is an error: pick the next slug (`v6`).

**The config declares the steps, in the order they run:**

```json
{
  "steps": [
    {"id": "hyde",     "kind": "hyde",     "provider": "openai",   "model": "gpt-5-mini"},
    {"id": "dense",    "kind": "retrieve", "method": "dense",       "top_k": 20},
    {"id": "bm25",     "kind": "retrieve", "method": "bm25",        "top_k": 20, "k1": 1.2, "b": 0.75},
    {"id": "fuse",     "kind": "fuse",     "method": "rrf",         "k": 60, "inputs": ["dense", "bm25"]},
    {"id": "rerank",   "kind": "rerank",   "provider": "st-local",  "model": "BAAI/bge-reranker-v2-m3", "top_n": 5},
    {"id": "generate", "kind": "generate", "provider": "openai",   "model": "gpt-5-mini", "temperature": 0.2,
                       "prompt": {"template": "answer-with-citations", "version": 1}},
    {"id": "judge",    "kind": "judge",    "provider": "openai",   "model": "gpt-5.4", "rubric": "erag-v1"}
  ],
  "advanced": {"anything": "experimental"}
}
```

| Field | Rule |
|---|---|
| `id` | Unique within the version; the step's name everywhere (results, events, the UI). Reserved: `total`, `ingest`, `chunk`, `embed`, `index`. |
| `kind` | What the step does. Known kinds (`lab.step_def`) get a label and a description: `route`, `query_rewrite`, `decompose`, `hyde`, `retrieve`, `fuse`, `rerank`, `filter`, `compress`, `generate`, `verify`, `judge`. Any other kind works too; the UI labels it with its name. |
| `provider` | The provider whose model the step calls. It drives the LOCAL/CLOUD badge and which provider is billed for the step's cost. A `retrieve` step with `method` `dense` and no provider uses the embedding space's provider, since it embeds the question with that model. |
| everything else | The step's settings, shown as chips on its card and compared in diffs. |

**Position is part of the version.** The list order is the pipeline order: the Pipeline page draws it, run
progress follows it, and moving a step makes a new version. Comparing two versions, the UI marks each step as
new, changed (settings), moved (place in the order), or removed.

A step that runs in parallel with another (two retrievers feeding a fusion) is still listed in sequence; say
which inputs it takes in its settings, as `inputs` does above.

*In the UI:* the version appears on the timeline with its parent, note and config diff, using paths like
`steps.rerank.top_n` and `step_order`. It has no metrics yet.

## Step 4: claim a queued run, or create one

The UI's **Queue run** button inserts a `queued` run, possibly with `overrides`. Take the oldest one safely:

```sql
select * from lab.claim_run(:worker_name, :experiment_id_or_null, :git_commit, :environment_jsonb);
-- one row (now status 'running', started_at set), or no row when nothing is queued
```

`claim_run` uses `FOR UPDATE SKIP LOCKED`, so two spikes running at once never take the same run.

**Overrides address steps by id.** Let the database apply them, so every language gets the same result:

```sql
select lab.apply_overrides(e.config, r.overrides) from lab.experiment e join lab.run r on r.experiment_id = e.id
where r.id = :run_id;                                       -- the run's effective config, steps in order
```

| Override | Effect |
|---|---|
| `{"steps": {"rerank": {"top_n": 8}}}` | changes one setting of one step |
| `{"steps": {"hyde": {"kind": "hyde", "model": "gpt-5-mini"}}}` | adds a step (at the end, unless `step_order` places it) |
| `{"steps": {"bm25": null}}` | leaves a step out of this run |
| `{"step_order": ["dense", "hyde", "rerank", "generate"]}` | runs the steps in another order |
| `{"advanced": {"x": 1}}` | anything else deep-merges: objects key by key, other values replaced |

Nothing queued? Start your own run directly:

```sql
insert into lab.run (experiment_id, status, worker, git_commit, environment)
values (:experiment_id, 'running', :worker, :git_commit, '{"python": "3.12.7", "host": "..."}')
returning id;
```

A run moves `queued → running → done | failed` and nothing else. Once it is `done` or `failed`, it is frozen.

*In the UI:* the run appears on the Runs page and in the dock's Run panel, with one progress bar per step of
the effective config.

## Step 5: stream events

```sql
insert into lab.run_event (run_id, stage, level, message, data)
values (:run_id, 'rerank', 'info', 'reranked 17 of 30', '{"state": "progress", "done": 17, "total": 30}');
```

| Field | Values |
|---|---|
| `stage` | the library's `ingest`, `chunk`, `embed`, `index`, or **a step id** from the run's steps |
| `level` | `debug`, `info`, `warn`, `error` (`warn` and `error` show in amber) |
| `data.state` | `start`, `progress`, `done`, `failed`; with `done` / `total` counts for the progress bar |

The **last event per stage** decides its bar. Send one when a step starts, every few items, and when it ends.
A stage name that isn't one of the run's steps still shows, at the end. Events can also be sent while a run is
still `queued`, e.g. "picked up, preparing".

*In the UI:* step bars and the event log update live (every 3 to 5 seconds).

## Step 6: results

Write these while the run is `running`; inserts into a finished run are rejected. **Everything is keyed by step
id.**

**Per question:**

```sql
insert into lab.question_result
  (run_id, question_id, answer, citations, metrics, latency_ms, tokens, cost, cost_usd, judge_rationale)
values (:run_id, :question_id,
  '200 ms [1]',
  '[{"marker": "[1]", "chunk_id": 1234, "rank": 1}]',
  '{"correctness": 1, "faithfulness": 0.95, "answer_relevance": 0.9, "recall_at_k": 1, "precision_at_k": 0.2,
    "hit_rate": 1, "mrr": 1, "ndcg": 1, "context_precision": 1, "context_recall": 1}',
  '{"hyde": 510, "dense": 140, "rerank": 190, "generate": 1900, "judge": 1400, "total": 2740}',
  '{"prompt": 1650, "completion": 120, "judge": 2700}',
  '{"hyde": 0.0001, "dense": 0.000003, "rerank": 0, "generate": 0.0006, "judge": 0.0089}',
  0.0007,                                       -- cost_usd: everything except the judge
  'Matches the gold answer and cites the supporting chunk.');
```

- `metrics`: any names. Known ones (`lab.metric_def`) get labels, formats and better/worse colours; unknown
  ones still show, with defaults. `correctness` is the primary metric behind the ▲ / ▼ verdicts.
- `latency_ms`: **one key per step id**, in ms, plus `total` (answer latency without the judge).
- `cost`: **one key per step id**. Each step's cost is billed to that step's provider on the Providers page.
- `citations`: `marker` must match the text in `answer`, and `chunk_id` must be one of the retrieved chunks.

**Retrieved chunks, for every step that produces a ranked list:**

```sql
insert into lab.retrieval_hit (run_id, question_id, stage, rank, chunk_id, score)
values (:run_id, :question_id, 'rerank', 1, :chunk_id, 3.21);
-- stage = the step id (dense, bm25, fuse, rerank, ...); rank starts at 1.
```

**The final context** (what the generator saw, and what the Questions and Space pages highlight) is the list of
the **last step, in the version's order, that produced one**. Write the lists in the order the steps ran, and
make sure the step whose list the generator used is the last one that writes hits.

**Aggregates for the whole run:**

```sql
insert into lab.run_metric (run_id, name, scope, value) values
  (:run_id, 'correctness',    'all',          0.83),   -- the headline numbers
  (:run_id, 'latency_p50_ms', 'all',          2155),
  (:run_id, 'latency_p95_ms', 'step:rerank',  250),    -- per step
  (:run_id, 'correctness',    'tag:semantic', 1.0);    -- per question type
```

| Scope | Meaning |
|---|---|
| `all` | the whole run: these become the version's headline numbers (timeline, Pipeline, Compare) |
| `step:<id>` | one step |
| `tag:<qtype>` | one question type (`basic`, `semantic`, `constrained`, `conflicting_info`, ...) |

Ops metrics the UI knows: `latency_p50_ms`, `latency_p95_ms`, `tokens_per_query`, `cost_per_query_usd`,
`index_build_s`, `index_size_mb`. Per-step latency and cost on the Pipeline page come straight from
`latency_ms` and `cost`, so they need no extra metrics.

## Step 7: finish

```sql
update lab.run
set status = 'done', total_cost_usd = :total, stage_cost = '{"generate": 0.02, "judge": 0.27}'
where id = :run_id;                                       -- finished_at is filled in for you

-- or, when something broke:
update lab.run set status = 'failed', error = 'rerank: model failed to load' where id = :run_id;
```

Partial results don't count. A failed run keeps its events and error, but the UI only reads results from each
version's **latest done** run.

*In the UI:* the version's metrics, Pipeline numbers, Questions table, Space highlights, Compare columns,
Providers spend and Log entries all switch to this run.

---

## Checklist for a new spike

1. `ensure_corpus_version` → documents (with `metadata`) → `ensure_chunk_set` → chunks → `ensure_eval_set` →
   questions + gold spans
2. `create_embedding_space` → vectors into `lab.emb_<id>` → `build_stats` → projections, optionally with `z`,
   `cluster` and several methods (skip if reused)
3. `ensure_experiment` with `parent_id`, a note saying why, and `config.steps` in order
4. `claim_run` (or insert a `running` run) → `lab.apply_overrides` for the effective steps
5. `run_event` per step: start, progress, done
6. per question: `question_result` (latency and cost by step id) + `retrieval_hit` (stage = step id); then `run_metric`
7. `status = 'done'` (or `'failed'` with `error`)

When a spike needs something the UI doesn't know yet (a new step kind, a new setting, a new metric), write it
anyway: it is stored, shown with defaults, and can be given a proper label later in `lab.step_def` or
`lab.metric_def`. No migration and no frontend change are needed.
