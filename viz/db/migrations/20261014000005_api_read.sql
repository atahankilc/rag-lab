-- The read side of the api schema: everything the UI GETs through PostgREST.
-- Views run with the owner's rights, so web_anon needs SELECT on these views and nothing in lab.
--
-- Pipelines are data: a version's config.steps is an ordered list of steps, and every view below
-- follows that list. Nothing here names a particular step, except the library's fixed shape
-- (ingest -> chunk -> embed -> index), which comes from the artifact tables.

-- migrate:up

-- ---------- json helpers ----------

-- {"a": {"b": 1}, "c": [1, 2]}  ->  ("a.b", 1), ("c", [1, 2])   (arrays are leaves)
-- plpgsql on purpose: a SQL function would be inlined into joins, and the planner then
-- re-runs the recursive query for every joined row (300 ms instead of 0.3 ms).
create function lab.jsonb_flatten(doc jsonb)
returns table (path text, value jsonb)
language plpgsql immutable as $$
begin
  return query
  with recursive walk(path, value) as (
    select e.key, e.value from jsonb_each(coalesce(jsonb_flatten.doc, '{}')) e
    union all
    select walk.path || '.' || e.key, e.value
    from walk
    cross join lateral jsonb_each(case when jsonb_typeof(walk.value) = 'object' then walk.value else '{}' end) e
  )
  select walk.path, walk.value from walk
  where jsonb_typeof(walk.value) <> 'object' or walk.value = '{}'::jsonb;
end $$;

-- Merge b into a: objects merge key by key, a JSON null in b removes the key, anything else replaces.
create function lab.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k text;
  v jsonb;
  out jsonb := coalesce(a, '{}');
begin
  if b is null then return a; end if;
  if jsonb_typeof(out) <> 'object' or jsonb_typeof(b) <> 'object' then return b; end if;
  for k, v in select * from jsonb_each(b) loop
    if v = 'null'::jsonb then
      out := out - k;
    elsif out ? k and jsonb_typeof(out -> k) = 'object' and jsonb_typeof(v) = 'object' then
      out := jsonb_set(out, array[k], lab.jsonb_deep_merge(out -> k, v));
    else
      out := jsonb_set(out, array[k], v);
    end if;
  end loop;
  return out;
end $$;

-- The "keyed" form of a pipeline config: steps as an object by id, plus the order as its own field.
--   {"steps": [{"id": "dense", "kind": "retrieve", "top_k": 5}]}
--   -> {"steps": {"dense": {"kind": "retrieve", "top_k": 5}}, "step_order": ["dense"]}
-- Diffs and run overrides use this form, so "change rerank.top_n" or "move rerank" are single paths.
create function lab.steps_keyed(config jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(config -> 'steps') = 'array' then
    (config - 'steps') || jsonb_build_object(
      'steps', coalesce((select jsonb_object_agg(s ->> 'id', s - 'id') from jsonb_array_elements(config -> 'steps') s), '{}'),
      'step_order', coalesce((select jsonb_agg(s ->> 'id' order by i) from jsonb_array_elements(config -> 'steps') with ordinality t(s, i)), '[]'))
  else coalesce(config, '{}') end
$$;

-- A run's effective config: the version's config with the run's overrides applied.
--   overrides use the keyed form: {"steps": {"rerank": {"top_n": 8}}} changes one setting,
--   {"steps": {"hyde": {"kind": "hyde", ...}}} adds a step (at the end unless step_order says otherwise),
--   {"steps": {"bm25": null}} removes one, {"step_order": ["hyde", "dense", ...]} reorders.
-- Returns the normal form again (steps as an ordered list).
create function lab.apply_overrides(config jsonb, overrides jsonb) returns jsonb
language plpgsql immutable as $$
declare
  keyed jsonb := lab.steps_keyed(coalesce(config, '{}'));
  merged jsonb;
  ord jsonb;
  steps jsonb := '[]';
  id text;
begin
  if overrides is null or overrides = '{}'::jsonb then return config; end if;
  merged := lab.jsonb_deep_merge(keyed - 'step_order', coalesce(overrides, '{}') - 'step_order');
  if not (merged ? 'steps') then return merged; end if;    -- a config without steps stays without
  ord := coalesce(overrides -> 'step_order', keyed -> 'step_order', '[]');
  -- the ordered ids first, then any added step the order doesn't mention
  for id in
    select x from jsonb_array_elements_text(ord) with ordinality t(x, i) order by i
  loop
    if merged -> 'steps' ? id then
      steps := steps || jsonb_build_array(jsonb_build_object('id', id) || (merged -> 'steps' -> id));
    end if;
  end loop;
  for id in select k from jsonb_object_keys(coalesce(merged -> 'steps', '{}')) k loop
    if not exists (select 1 from jsonb_array_elements(steps) s where s ->> 'id' = id) then
      steps := steps || jsonb_build_array(jsonb_build_object('id', id) || (merged -> 'steps' -> id));
    end if;
  end loop;
  return (merged - 'steps') || jsonb_build_object('steps', steps);
end $$;

-- ---------- what a version is ----------

-- The full config of a version in keyed form: the library (corpus, chunking, embedding, eval set)
-- plus the pipeline. This is what config diffs compare.
create view lab.experiment_config as
select
  e.id as experiment_id,
  jsonb_build_object(
    'corpus',    jsonb_build_object('name', cv.name, 'hash', left(cv.config_hash, 12)),
    'chunking',  cs.config,
    'embedding', jsonb_build_object('provider', es.provider_id, 'model', es.model, 'dim', es.dim,
                                    'location', es.location) || es.config,
    'eval_set',  jsonb_build_object('name', ev.name, 'version', ev.version)
  ) || lab.steps_keyed(e.config) as config
from lab.experiment e
join lab.corpus_version cv on cv.id = e.corpus_version_id
join lab.chunk_set cs on cs.id = e.chunk_set_id
join lab.embedding_space es on es.id = e.embedding_space_id
join lab.eval_set ev on ev.id = e.eval_set_id;

-- One row per pipeline step of each version, in order. A dense retrieve step without its own
-- provider uses the version's embedding provider (it embeds the question with that model).
create view lab.experiment_step as
select
  e.id as experiment_id, t.i::int as ord, t.s ->> 'id' as step_id, t.s ->> 'kind' as kind,
  coalesce(t.s ->> 'provider',
           case when t.s ->> 'kind' = 'retrieve' and coalesce(t.s ->> 'method', 'dense') in ('dense', 'vector')
                then es.provider_id end) as provider_id,
  t.s - 'id' - 'kind' as config
from lab.experiment e
join lab.embedding_space es on es.id = e.embedding_space_id
cross join lateral jsonb_array_elements(case when jsonb_typeof(e.config -> 'steps') = 'array' then e.config -> 'steps' else '[]' end)
  with ordinality t(s, i);

create view lab.latest_run as
select distinct on (experiment_id) experiment_id, id as run_id
from lab.run
where status = 'done'
order by experiment_id, finished_at desc, id desc;

create view lab.baseline as
select id as experiment_id from lab.experiment where is_baseline;

-- Only the fields that differ between two versions. a = reference, b = the other one.
-- Paths use the keyed form: "steps.rerank.top_n", "step_order", "chunking.size".
create function api.config_diff(a bigint, b bigint)
returns table (path text, a_value jsonb, b_value jsonb)
language sql stable security definer set search_path = lab, pg_temp
as $$
  select coalesce(x.path, y.path), x.value, y.value
  from (select f.path, f.value from lab.experiment_config c, lab.jsonb_flatten(c.config) f
        where c.experiment_id = config_diff.a) x
  full join
       (select f.path, f.value from lab.experiment_config c, lab.jsonb_flatten(c.config) f
        where c.experiment_id = config_diff.b) y
    on x.path = y.path
  where x.value is distinct from y.value
  order by 1
$$;

-- What a diff path is about: "steps.rerank.top_n" -> "rerank", "chunking.size" -> "chunking".
create function lab.diff_subject(path text) returns text
language sql immutable as $$
  select case when path like 'steps.%' then split_part(path, '.', 2)
              when path = 'step_order' then 'step order'
              else split_part(path, '.', 1) end
$$;

-- The timeline: one row per version, oldest first.
create view api.experiments as
select
  e.id, e.slug, e.name, e.parent_id, p.slug as parent_slug, e.note, e.status, e.is_baseline, e.created_at,
  (row_number() over (order by e.created_at, e.id) - 1)::int as ord,
  e.corpus_version_id, e.chunk_set_id, e.embedding_space_id, e.eval_set_id,
  cs.name as chunk_set_name, es.model as embedding_model, es.location as embedding_location,
  (select coalesce(jsonb_agg(s ->> 'id' order by i), '[]')
   from jsonb_array_elements(case when jsonb_typeof(e.config -> 'steps') = 'array' then e.config -> 'steps' else '[]' end)
        with ordinality t(s, i)) as step_ids,
  lr.run_id as latest_run_id,
  last_run.id as last_run_id, last_run.status as last_run_status,
  coalesce((select jsonb_object_agg(m.name, m.value) from lab.run_metric m
            where m.run_id = lr.run_id and m.scope = 'all'), '{}') as metrics,
  d.diff_count, d.changed_keys,
  (select count(*)::int from lab.experiment_note n where n.experiment_id = e.id) as note_count
from lab.experiment e
left join lab.experiment p on p.id = e.parent_id
join lab.chunk_set cs on cs.id = e.chunk_set_id
join lab.embedding_space es on es.id = e.embedding_space_id
left join lab.latest_run lr on lr.experiment_id = e.id
left join lateral (select r.id, r.status from lab.run r where r.experiment_id = e.id
                   order by r.queued_at desc, r.id desc limit 1) last_run on true
left join lateral (
  select count(*)::int as diff_count,
         coalesce(array_agg(distinct lab.diff_subject(cd.path)) filter (where cd.path is not null), '{}') as changed_keys
  from api.config_diff(e.parent_id, e.id) cd
  where e.parent_id is not null
) d on true;

create view api.experiment_detail as
select
  e.id, e.slug, e.name, e.parent_id, e.note, e.status, e.is_baseline, e.created_at, e.config_hash,
  e.config as pipeline_config,
  ec.config,
  jsonb_build_object('id', cv.id, 'name', cv.name, 'hash', cv.config_hash, 'manifest', cv.manifest,
    'documents', (select count(*) from lab.document d where d.corpus_version_id = cv.id)) as corpus,
  jsonb_build_object('id', cs.id, 'name', cs.name, 'config', cs.config, 'hash', cs.config_hash,
    'chunks', (select count(*) from lab.chunk c where c.chunk_set_id = cs.id)) as chunk_set,
  jsonb_build_object('id', es.id, 'provider', es.provider_id, 'model', es.model, 'dim', es.dim,
    'location', es.location, 'config', es.config, 'table', es.table_name, 'build_stats', es.build_stats,
    'hash', es.config_hash) as embedding_space,
  jsonb_build_object('id', ev.id, 'name', ev.name, 'version', ev.version,
    'questions', (select count(*) from lab.eval_question q where q.eval_set_id = ev.id)) as eval_set,
  coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'actor', n.actor, 'created_at', n.created_at)
                             order by n.created_at)
            from lab.experiment_note n where n.experiment_id = e.id), '[]') as notes,
  lr.run_id as latest_run_id,
  coalesce((select jsonb_agg(jsonb_build_object('name', m.name, 'scope', m.scope, 'value', m.value))
            from lab.run_metric m where m.run_id = lr.run_id), '[]') as metrics
from lab.experiment e
join lab.experiment_config ec on ec.experiment_id = e.id
join lab.corpus_version cv on cv.id = e.corpus_version_id
join lab.chunk_set cs on cs.id = e.chunk_set_id
join lab.embedding_space es on es.id = e.embedding_space_id
join lab.eval_set ev on ev.id = e.eval_set_id
left join lab.latest_run lr on lr.experiment_id = e.id;

create view api.step_defs as select * from lab.step_def;

-- ---------- the pipeline page ----------

-- Every step of every version, in order: the library's three fixed steps (from the artifacts),
-- then the version's own steps. Counts, latency and cost come from the latest finished run.
-- diff_prefix says which config_diff paths belong to the row ("chunking", "steps.rerank", ...).
create view api.step_summary as
with lib as (
  select e.id as experiment_id, x.ord, x.step_id, x.step_id as kind, x.diff_prefix, x.config, x.item_count,
         x.provider_id, x.location
  from lab.experiment e
  join lab.corpus_version cv on cv.id = e.corpus_version_id
  join lab.chunk_set cs on cs.id = e.chunk_set_id
  join lab.embedding_space es on es.id = e.embedding_space_id
  cross join lateral (values
    (1, 'ingest', 'corpus',
        jsonb_build_object('name', cv.name),
        (select count(*) from lab.document d where d.corpus_version_id = e.corpus_version_id),
        null::text, null::text),
    (2, 'chunk', 'chunking', cs.config,
        (select count(*) from lab.chunk c where c.chunk_set_id = e.chunk_set_id),
        null, null),
    (3, 'embed', 'embedding',
        jsonb_build_object('model', es.model, 'dim', es.dim) || es.config,
        coalesce((es.build_stats ->> 'vectors')::bigint, (select count(*) from lab.chunk c where c.chunk_set_id = e.chunk_set_id)),
        es.provider_id, es.location)
  ) x(ord, step_id, diff_prefix, config, item_count, provider_id, location)
),
steps as (
  select s.experiment_id, 10 + s.ord as ord, s.step_id, s.kind, 'steps.' || s.step_id as diff_prefix, s.config,
         (select coalesce(nullif(count(distinct (h.question_id, h.chunk_id)), 0),
                          (select count(*) from lab.question_result q where q.run_id = lr.run_id and q.latency_ms ? s.step_id))
          from lab.retrieval_hit h where h.run_id = lr.run_id and h.stage = s.step_id) as item_count,
         s.provider_id, p.location
  from lab.experiment_step s
  left join lab.latest_run lr on lr.experiment_id = s.experiment_id
  left join lab.provider p on p.id = s.provider_id
)
select
  r.experiment_id, e.slug, r.ord, r.step_id, r.kind,
  coalesce(sd.phase, case when r.ord < 10 then 'index' else 'query' end) as phase,
  coalesce(sd.label, r.kind) as kind_label,
  coalesce(sd.description, 'A ' || r.kind || ' step.') as description,
  r.diff_prefix, r.config, r.item_count, r.provider_id, r.location,
  lat.p50_ms, lat.p95_ms, cost.cost_usd,
  cost.cost_usd / nullif((select count(*) from lab.question_result q where q.run_id = lr.run_id), 0) as cost_per_query_usd,
  lr.run_id
from (select * from lib union all select * from steps) r
join lab.experiment e on e.id = r.experiment_id
left join lab.step_def sd on sd.kind = r.kind
left join lab.latest_run lr on lr.experiment_id = r.experiment_id
left join lateral (
  select percentile_cont(0.5)  within group (order by (q.latency_ms ->> r.step_id)::double precision) as p50_ms,
         percentile_cont(0.95) within group (order by (q.latency_ms ->> r.step_id)::double precision) as p95_ms
  from lab.question_result q
  where q.run_id = lr.run_id and q.latency_ms ? r.step_id
) lat on true
left join lateral (
  select sum((q.cost ->> r.step_id)::numeric) as cost_usd
  from lab.question_result q
  where q.run_id = lr.run_id and q.cost ? r.step_id
) cost on true;

-- ---------- questions ----------

-- Per question, for each version's latest finished run, with the same question in the parent
-- version and in the pinned baseline. Verdicts use the primary metric (correctness).
create view api.question_results as
with primary_metric as (
  select coalesce((select name from lab.metric_def where is_primary), 'correctness') as name
),
res as (
  select lr.experiment_id, q.*
  from lab.latest_run lr join lab.question_result q on q.run_id = lr.run_id
)
select
  e.id as experiment_id, e.slug, r.run_id, eq.id as question_id, eq.external_id, eq.qtype, eq.tags,
  eq.question, eq.gold_answer,
  r.answer, r.citations, r.metrics, r.latency_ms, r.tokens, r.cost_usd, r.judge_rationale,
  (r.latency_ms ->> 'total')::double precision as latency_total_ms,
  pm.name as primary_metric,
  (r.metrics ->> pm.name)::double precision as score,
  pr.metrics as parent_metrics,
  (pr.metrics ->> pm.name)::double precision as parent_score,
  (r.metrics ->> pm.name)::double precision - (pr.metrics ->> pm.name)::double precision as delta_parent,
  br.metrics as baseline_metrics,
  (br.metrics ->> pm.name)::double precision as baseline_score,
  (r.metrics ->> pm.name)::double precision - (br.metrics ->> pm.name)::double precision as delta_baseline,
  case when pr.question_id is null then null
       when (r.metrics ->> pm.name)::double precision - (pr.metrics ->> pm.name)::double precision >= 0.1 then 'better'
       when (r.metrics ->> pm.name)::double precision - (pr.metrics ->> pm.name)::double precision <= -0.1 then 'worse'
       else 'unchanged' end as verdict_parent,
  case when br.question_id is null or b.experiment_id = e.id then null
       when (r.metrics ->> pm.name)::double precision - (br.metrics ->> pm.name)::double precision >= 0.1 then 'better'
       when (r.metrics ->> pm.name)::double precision - (br.metrics ->> pm.name)::double precision <= -0.1 then 'worse'
       else 'unchanged' end as verdict_baseline
from res r
cross join primary_metric pm
join lab.experiment e on e.id = r.experiment_id
join lab.eval_question eq on eq.id = r.question_id
left join res pr on pr.experiment_id = e.parent_id and pr.question_id = r.question_id
left join lab.baseline b on true
left join res br on br.experiment_id = b.experiment_id and br.question_id = r.question_id;

-- Relevance: a chunk is relevant to a question if it overlaps one of the gold spans.
create view api.relevant_chunks as
select distinct c.chunk_set_id, g.question_id, c.id as chunk_id
from lab.gold_evidence g
join lab.chunk c on c.document_id = g.document_id
               and c.char_start < g.char_end and g.char_start < c.char_end;

-- Every retrieved chunk, per run, question and step, with its relevance mark and char span.
create view api.retrieval_hits as
select
  h.run_id, r.experiment_id, h.question_id, h.stage, h.rank, h.score, h.chunk_id,
  c.document_id, d.title as document_title, d.source, c.ord as chunk_ord, c.token_count, c.text,
  exists (select 1 from lab.gold_evidence g
          where g.question_id = h.question_id and g.document_id = c.document_id
            and c.char_start < g.char_end and g.char_start < c.char_end) as relevant,
  c.char_start, c.char_end
from lab.retrieval_hit h
join lab.run r on r.id = h.run_id
join lab.chunk c on c.id = h.chunk_id
join lab.document d on d.id = c.document_id;

create view api.eval_questions as
select q.id, q.eval_set_id, q.external_id, q.qtype, q.tags, q.source_types, q.question, q.gold_answer, q.answer_facts,
  coalesce((select jsonb_agg(jsonb_build_object(
              'document_id', g.document_id, 'document_title', d.title,
              'char_start', g.char_start, 'char_end', g.char_end,
              'text', substr(d.text, g.char_start + 1, g.char_end - g.char_start)) order by g.id)
            from lab.gold_evidence g join lab.document d on d.id = g.document_id
            where g.question_id = q.id), '[]') as evidence
from lab.eval_question q;

-- ---------- metrics ----------

create view api.metric_matrix as
select
  e.id as experiment_id, e.slug,
  (row_number() over (partition by m.name, m.scope order by e.created_at, e.id) - 1)::int as pos,
  m.run_id, m.name, m.scope, m.value,
  coalesce(md.label, m.name) as label,
  coalesce(md.grp, 'other') as grp,
  md.unit, coalesce(md.higher_is_better, true) as higher_is_better,
  coalesce(md.format, 'ratio') as format, coalesce(md.sort, 1000) as sort,
  md.name is not null as known
from lab.latest_run lr
join lab.experiment e on e.id = lr.experiment_id
join lab.run_metric m on m.run_id = lr.run_id
left join lab.metric_def md on md.name = m.name;

create view api.metric_defs as select * from lab.metric_def;

-- Metrics of any run (not only each version's latest), for the Runs page.
create view api.run_metrics as
select m.run_id, m.name, m.scope, m.value,
       coalesce(md.label, m.name) as label, coalesce(md.format, 'ratio') as format,
       coalesce(md.higher_is_better, true) as higher_is_better, coalesce(md.sort, 1000) as sort
from lab.run_metric m
left join lab.metric_def md on md.name = m.name;

-- ---------- space ----------

create view api.spaces as
select es.id, es.chunk_set_id, cs.name as chunk_set_name, es.provider_id, es.model, es.dim, es.location,
       es.config, es.table_name, es.build_stats, es.created_at,
       (select array_agg(distinct p.method) from lab.projection p where p.space_id = es.id) as methods
from lab.embedding_space es join lab.chunk_set cs on cs.id = es.chunk_set_id;

create view api.space_points as
select
  p.space_id, p.method, p.chunk_id, p.x, p.y, p.z,
  c.chunk_set_id, c.document_id, c.ord, c.char_start, c.char_end, c.token_count, c.text,
  (dense_rank() over (partition by p.space_id, p.method order by d.id) - 1)::int as doc_index,
  d.title as document_title, d.source, d.project
from lab.projection p
join lab.chunk c on c.id = p.chunk_id
join lab.document d on d.id = c.document_id;

create view api.query_points as
select qp.space_id, qp.method, qp.question_id, qp.x, qp.y, qp.z, q.external_id, q.qtype, q.question
from lab.query_projection qp join lab.eval_question q on q.id = qp.question_id;

create view api.chunks as
select c.id, c.chunk_set_id, c.document_id, c.ord, c.char_start, c.char_end, c.token_count, c.parent_chunk_id,
       c.text, d.title as document_title, d.source, d.project, d.external_id as document_external_id
from lab.chunk c join lab.document d on d.id = c.document_id;

create view api.documents as
select d.id, d.corpus_version_id, d.external_id, d.source, d.title, d.author, d.project, d.doc_date,
       d.metadata, d.char_count
from lab.document d;

create view api.experiment_notes as
select n.id, n.experiment_id, e.slug, n.body, n.actor, n.created_at
from lab.experiment_note n join lab.experiment e on e.id = n.experiment_id;

-- ---------- runs ----------

create view api.runs as
select
  r.id, r.experiment_id, e.slug, e.name as experiment_name, r.status, r.overrides,
  r.queued_at, r.started_at, r.finished_at,
  (extract(epoch from (coalesce(r.finished_at, case when r.status = 'running' then now() end) - r.started_at)) * 1000)::bigint as duration_ms,
  r.total_cost_usd, r.stage_cost, r.git_commit, r.environment, r.worker, r.error,
  (select count(*)::int from lab.question_result q where q.run_id = r.id) as results,
  (select count(*)::int from lab.eval_question q where q.eval_set_id = e.eval_set_id) as questions,
  (select count(*)::int from lab.run_event ev where ev.run_id = r.id) as events
from lab.run r join lab.experiment e on e.id = r.experiment_id;

create view api.run_events as
select ev.id, ev.run_id, ev.ts, ev.stage, ev.level, ev.message, ev.data from lab.run_event ev;

-- Progress of each run, one entry per step, from the last event of that step: the library's four
-- steps, then the run's own steps (the version's steps with the run's overrides applied), then any
-- other stage name the backend reported.
create view api.run_progress as
select
  r.id as run_id, r.experiment_id, e.slug, r.status, r.queued_at, r.started_at, r.finished_at, r.overrides,
  (select jsonb_agg(jsonb_build_object(
      'stage', s.stage, 'kind', s.kind, 'label', s.label,
      'state', case
                 when r.status = 'done' then 'done'
                 when last.id is null then 'pending'
                 else coalesce(last.data ->> 'state', 'running') end,
      'done',  (last.data ->> 'done')::int,
      'total', (last.data ->> 'total')::int,
      'level', last.level,
      'message', last.message,
      'ts', last.ts
    ) order by s.ord)
   from (
     select x.stage, x.stage as kind, sd.label, x.ord
     from (values ('ingest', 1), ('chunk', 2), ('embed', 3), ('index', 4)) x(stage, ord)
     left join lab.step_def sd on sd.kind = x.stage
     union all
     select st ->> 'id', st ->> 'kind', st ->> 'id', 10 + i
     from jsonb_array_elements(coalesce(lab.apply_overrides(e.config, r.overrides) -> 'steps', '[]')) with ordinality t(st, i)
     union all
     select ev.stage, ev.stage, ev.stage, 1000 + min(ev.id)
     from lab.run_event ev
     where ev.run_id = r.id and ev.stage is not null
       and ev.stage not in ('ingest', 'chunk', 'embed', 'index')
       and not exists (select 1 from jsonb_array_elements(coalesce(lab.apply_overrides(e.config, r.overrides) -> 'steps', '[]')) st
                       where st ->> 'id' = ev.stage)
     group by ev.stage
   ) s
   left join lateral (select ev.* from lab.run_event ev where ev.run_id = r.id and ev.stage = s.stage
                      order by ev.ts desc, ev.id desc limit 1) last on true
  ) as stages
from lab.run r
join lab.experiment e on e.id = r.experiment_id;

-- ---------- providers ----------

-- Spend per provider: per-question costs (keyed by step id), attributed to that step's provider.
create view api.providers as
select
  p.id, p.name, p.kind, p.location, p.endpoint, p.key_env, p.models, p.enabled, p.spend_cap_usd, p.created_at,
  coalesce(sp.spent_usd, 0) as spent_usd,
  coalesce(sp.queries, 0) as queries,
  (select array_agg(dm.kind order by dm.kind) from lab.default_model dm where dm.provider_id = p.id) as default_kinds
from lab.provider p
left join lateral (
  select sum(c.value::numeric) as spent_usd, count(distinct (q.run_id, q.question_id))::int as queries
  from lab.question_result q
  join lab.run r on r.id = q.run_id
  cross join lateral jsonb_each_text(q.cost) c(key, value)
  join lab.experiment_step s on s.experiment_id = r.experiment_id and s.step_id = c.key
  where s.provider_id = p.id
) sp on true;

-- Which versions use each provider, in which steps, and what that cost.
create view api.provider_usage as
select
  s.provider_id, e.id as experiment_id, e.slug, e.name,
  array_agg(s.step_id order by s.ord) as step_ids,
  coalesce((
    select sum(c.value::numeric)
    from lab.run r
    join lab.question_result q on q.run_id = r.id
    cross join lateral jsonb_each_text(q.cost) c(key, value)
    where r.experiment_id = e.id and c.key = any (array_agg(s.step_id))
  ), 0) as spent_usd
from lab.experiment_step s
join lab.experiment e on e.id = s.experiment_id
where s.provider_id is not null
group by s.provider_id, e.id, e.slug, e.name, e.created_at
order by s.provider_id, e.created_at;

create view api.default_models as
select dm.kind, coalesce(sd.label, dm.kind) as kind_label, coalesce(sd.sort, 1000) as sort,
       dm.provider_id, dm.model, p.location, p.enabled
from lab.default_model dm
join lab.provider p on p.id = dm.provider_id
left join lab.step_def sd on sd.kind = dm.kind;

-- ---------- log ----------

create view api.log as
select l.id, l.ts, l.actor, l.action, l.target_type, l.target_id, l.experiment_id, e.slug,
       l.before, l.after, l.note, split_part(l.action, '.', 1) as kind
from lab.log_event l left join lab.experiment e on e.id = l.experiment_id;

-- Event counts by kind x actor x version, for the Log page's filter chips.
create view api.log_summary as
select split_part(l.action, '.', 1) as kind, l.actor, e.slug, count(*)::int as n, max(l.ts) as last_ts
from lab.log_event l
left join lab.experiment e on e.id = l.experiment_id
group by 1, 2, 3;

create index log_event_ts_id on lab.log_event (ts desc, id desc);

grant select on all tables in schema api to web_anon;

-- migrate:down
drop index if exists lab.log_event_ts_id;
drop view if exists api.log_summary, api.log, api.default_models, api.provider_usage, api.providers,
  api.run_progress, api.run_events, api.runs, api.experiment_notes, api.documents, api.chunks, api.query_points,
  api.space_points, api.spaces, api.run_metrics, api.metric_defs, api.metric_matrix, api.eval_questions,
  api.retrieval_hits, api.relevant_chunks, api.question_results, api.step_summary, api.step_defs,
  api.experiment_detail, api.experiments;
drop function if exists lab.diff_subject(text);
drop function if exists api.config_diff(bigint, bigint);
drop view if exists lab.baseline, lab.latest_run, lab.experiment_step, lab.experiment_config;
drop function if exists lab.apply_overrides(jsonb, jsonb);
drop function if exists lab.steps_keyed(jsonb);
drop function if exists lab.jsonb_deep_merge(jsonb, jsonb);
drop function if exists lab.jsonb_flatten(jsonb);
