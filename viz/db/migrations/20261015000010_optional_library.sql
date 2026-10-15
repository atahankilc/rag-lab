-- A version may run without part of the library.
--
--   no chunk set, no embedding space   closed-book (v0: the model answers without documents)
--   chunk set, no embedding space      lexical only (BM25 over chunks or whole documents)
--   chunk set + embedding space        everything with vectors, as before
--
-- An embedding space without a chunk set is meaningless and stays an error. The corpus and the eval
-- set are still required: every version answers the same questions about the same corpus.
-- The pipeline page shows the library steps a version has (ingest is always there).

-- migrate:up

alter table lab.experiment
  alter column chunk_set_id drop not null,
  alter column embedding_space_id drop not null,
  add constraint experiment_space_needs_chunks check (embedding_space_id is null or chunk_set_id is not null);

-- NULL would make the whole hash NULL, and a NULL hash is never a duplicate: re-running v0 would make a
-- second v0. '-' stands for "none". Rows with all ids keep exactly the hash they had.
alter table lab.experiment alter column config_hash set expression as (lab.config_hash(
  corpus_version_id::text || '/' || coalesce(chunk_set_id::text, '-') || '/' ||
  coalesce(embedding_space_id::text, '-') || '/' || eval_set_id::text, config));

-- Same function, with the same '-' for "none" when it looks up an existing version.
create or replace function lab.ensure_experiment(
  p_slug text, p_name text, p_parent_id bigint, p_note text,
  p_corpus_version_id bigint, p_chunk_set_id bigint, p_embedding_space_id bigint, p_eval_set_id bigint,
  p_config jsonb
) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into lab.experiment (slug, name, parent_id, note, corpus_version_id, chunk_set_id, embedding_space_id,
                              eval_set_id, config)
  values (p_slug, p_name, p_parent_id, p_note, p_corpus_version_id, p_chunk_set_id, p_embedding_space_id,
          p_eval_set_id, coalesce(p_config, '{}'))
  on conflict (config_hash) do nothing
  returning id into v_id;
  if v_id is null then   -- the same work is already a version: reuse it (whatever its slug)
    select id into v_id from lab.experiment
    where config_hash = lab.config_hash(
      p_corpus_version_id::text || '/' || coalesce(p_chunk_set_id::text, '-') || '/' ||
      coalesce(p_embedding_space_id::text, '-') || '/' || p_eval_set_id::text, coalesce(p_config, '{}'));
  end if;
  return v_id;
end $$;

-- experiment: config is frozen. Only status and is_baseline can change.
-- (config_hash is left out of the comparisons: generated columns are only computed after BEFORE triggers.)
create or replace function lab.guard_experiment() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DELETE on lab.experiment is not allowed' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'INSERT' then
    -- the artifacts that are there must belong together
    if new.chunk_set_id is not null and not exists (
         select 1 from lab.chunk_set cs
         where cs.id = new.chunk_set_id and cs.corpus_version_id = new.corpus_version_id) then
      raise exception 'experiment %: chunk_set must belong to the corpus_version', new.slug
        using errcode = 'foreign_key_violation';
    end if;
    if new.embedding_space_id is not null and not exists (
         select 1 from lab.embedding_space es
         where es.id = new.embedding_space_id and es.chunk_set_id = new.chunk_set_id) then
      raise exception 'experiment %: embedding_space must belong to the chunk_set', new.slug
        using errcode = 'foreign_key_violation';
    end if;
    perform lab.check_steps(new.slug, new.config);
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'is_baseline' - 'config_hash') <> (to_jsonb(old) - 'status' - 'is_baseline' - 'config_hash') then
    raise exception 'experiment % is immutable: only status and is_baseline can change', old.slug
      using errcode = 'restrict_violation',
            hint = 'To change the config, create a new experiment with parent_id = ' || old.id || '.';
  end if;
  return new;
end $$;

-- The views below are the ones from 20261014000005_api_read.sql with left joins to the chunk set and the
-- embedding space, so a version without them still shows up. Nothing else changes.

-- A part of the library a version doesn't have is left out of its config, so a diff against a version
-- that has it lists that part's fields as added.
create or replace view lab.experiment_config as
select
  e.id as experiment_id,
  jsonb_build_object(
    'corpus',    jsonb_build_object('name', cv.name, 'hash', left(cv.config_hash, 12)),
    'eval_set',  jsonb_build_object('name', ev.name, 'version', ev.version)
  )
  || case when cs.id is null then '{}' else jsonb_build_object('chunking', cs.config) end
  || case when es.id is null then '{}' else jsonb_build_object('embedding',
       jsonb_build_object('provider', es.provider_id, 'model', es.model, 'dim', es.dim,
                          'location', es.location) || es.config) end
  || lab.steps_keyed(e.config) as config
from lab.experiment e
join lab.corpus_version cv on cv.id = e.corpus_version_id
left join lab.chunk_set cs on cs.id = e.chunk_set_id
left join lab.embedding_space es on es.id = e.embedding_space_id
join lab.eval_set ev on ev.id = e.eval_set_id;

create or replace view lab.experiment_step as
select
  e.id as experiment_id, t.i::int as ord, t.s ->> 'id' as step_id, t.s ->> 'kind' as kind,
  coalesce(t.s ->> 'provider',
           case when t.s ->> 'kind' = 'retrieve' and coalesce(t.s ->> 'method', 'dense') in ('dense', 'vector')
                then es.provider_id end) as provider_id,
  t.s - 'id' - 'kind' as config
from lab.experiment e
left join lab.embedding_space es on es.id = e.embedding_space_id
cross join lateral jsonb_array_elements(case when jsonb_typeof(e.config -> 'steps') = 'array' then e.config -> 'steps' else '[]' end)
  with ordinality t(s, i);

create or replace view api.experiments as
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
left join lab.chunk_set cs on cs.id = e.chunk_set_id
left join lab.embedding_space es on es.id = e.embedding_space_id
left join lab.latest_run lr on lr.experiment_id = e.id
left join lateral (select r.id, r.status from lab.run r where r.experiment_id = e.id
                   order by r.queued_at desc, r.id desc limit 1) last_run on true
left join lateral (
  select count(*)::int as diff_count,
         coalesce(array_agg(distinct lab.diff_subject(cd.path)) filter (where cd.path is not null), '{}') as changed_keys
  from api.config_diff(e.parent_id, e.id) cd
  where e.parent_id is not null
) d on true;

-- chunk_set and embedding_space are null when the version has none.
create or replace view api.experiment_detail as
select
  e.id, e.slug, e.name, e.parent_id, e.note, e.status, e.is_baseline, e.created_at, e.config_hash,
  e.config as pipeline_config,
  ec.config,
  jsonb_build_object('id', cv.id, 'name', cv.name, 'hash', cv.config_hash, 'manifest', cv.manifest,
    'documents', (select count(*) from lab.document d where d.corpus_version_id = cv.id)) as corpus,
  case when cs.id is not null then jsonb_build_object('id', cs.id, 'name', cs.name, 'config', cs.config, 'hash', cs.config_hash,
    'chunks', (select count(*) from lab.chunk c where c.chunk_set_id = cs.id)) end as chunk_set,
  case when es.id is not null then jsonb_build_object('id', es.id, 'provider', es.provider_id, 'model', es.model, 'dim', es.dim,
    'location', es.location, 'config', es.config, 'table', es.table_name, 'build_stats', es.build_stats,
    'hash', es.config_hash) end as embedding_space,
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
left join lab.chunk_set cs on cs.id = e.chunk_set_id
left join lab.embedding_space es on es.id = e.embedding_space_id
join lab.eval_set ev on ev.id = e.eval_set_id
left join lab.latest_run lr on lr.experiment_id = e.id;

-- Library rows only for the parts a version has: chunk only with a chunk set, embed only with a space.
create or replace view api.step_summary as
with lib as (
  select e.id as experiment_id, x.ord, x.step_id, x.step_id as kind, x.diff_prefix, x.config, x.item_count,
         x.provider_id, x.location
  from lab.experiment e
  join lab.corpus_version cv on cv.id = e.corpus_version_id
  left join lab.chunk_set cs on cs.id = e.chunk_set_id
  left join lab.embedding_space es on es.id = e.embedding_space_id
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
  where (x.step_id <> 'chunk' or cs.id is not null)
    and (x.step_id <> 'embed' or es.id is not null)
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

-- migrate:down
-- Fails while a version without a chunk set or embedding space exists, on purpose: there is nothing to
-- point it at. The views keep their left joins; with both columns required again they return the same rows.
alter table lab.experiment drop constraint experiment_space_needs_chunks;
alter table lab.experiment alter column config_hash set expression as (lab.config_hash(
  corpus_version_id::text || '/' || chunk_set_id::text || '/' ||
  embedding_space_id::text || '/' || eval_set_id::text, config));
alter table lab.experiment
  alter column chunk_set_id set not null,
  alter column embedding_space_id set not null;
create or replace function lab.guard_experiment() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DELETE on lab.experiment is not allowed' using errcode = 'restrict_violation';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from lab.chunk_set cs
                   join lab.embedding_space es on es.chunk_set_id = cs.id
                   where cs.id = new.chunk_set_id and es.id = new.embedding_space_id
                     and cs.corpus_version_id = new.corpus_version_id) then
      raise exception 'experiment %: chunk_set must belong to the corpus_version and embedding_space to the chunk_set', new.slug
        using errcode = 'foreign_key_violation';
    end if;
    perform lab.check_steps(new.slug, new.config);
    return new;
  end if;
  if (to_jsonb(new) - 'status' - 'is_baseline' - 'config_hash') <> (to_jsonb(old) - 'status' - 'is_baseline' - 'config_hash') then
    raise exception 'experiment % is immutable: only status and is_baseline can change', old.slug
      using errcode = 'restrict_violation',
            hint = 'To change the config, create a new experiment with parent_id = ' || old.id || '.';
  end if;
  return new;
end $$;
create or replace function lab.ensure_experiment(
  p_slug text, p_name text, p_parent_id bigint, p_note text,
  p_corpus_version_id bigint, p_chunk_set_id bigint, p_embedding_space_id bigint, p_eval_set_id bigint,
  p_config jsonb
) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into lab.experiment (slug, name, parent_id, note, corpus_version_id, chunk_set_id, embedding_space_id,
                              eval_set_id, config)
  values (p_slug, p_name, p_parent_id, p_note, p_corpus_version_id, p_chunk_set_id, p_embedding_space_id,
          p_eval_set_id, coalesce(p_config, '{}'))
  on conflict (config_hash) do nothing
  returning id into v_id;
  if v_id is null then   -- the same work is already a version: reuse it (whatever its slug)
    select id into v_id from lab.experiment
    where config_hash = lab.config_hash(
      p_corpus_version_id::text || '/' || p_chunk_set_id::text || '/' || p_embedding_space_id::text || '/' ||
      p_eval_set_id::text, coalesce(p_config, '{}'));
  end if;
  return v_id;
end $$;
