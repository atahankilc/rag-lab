-- The full Space page: generic fields, clusters, field settings, and true nearest neighbours.
--
--   chunk.metadata            anything that describes a chunk (section, sheet, row, file path, ...)
--   projection.cluster        an optional cluster id per chunk, written by the spike (e.g. HDBSCAN)
--   field_style               how the UI shows a field (label, type, hidden, colour per value),
--                             edited on the Space page, keyed by corpus name so a rebuilt corpus keeps it
--   api.chunk_neighbours(...)  the real nearest neighbours of a chunk, by cosine distance over its vectors
--
-- The Space page discovers fields from the data itself: document columns, every key in document.metadata
-- and chunk.metadata, chunk size and position, clusters, and how the latest run retrieved each chunk.
-- Nothing here names a kind of source (Jira, GitHub, spreadsheets, ...).

-- migrate:up

alter table lab.chunk add column metadata jsonb not null default '{}';
alter table lab.projection add column cluster int;     -- null = not clustered; -1 = noise (HDBSCAN)

create table lab.field_style (
  corpus_name text not null,                           -- lab.corpus_version.name
  field       text not null,                           -- e.g. 'document.source', 'chunk.metadata.section'
  label       text,                                    -- null = derived from the field name
  kind        text check (kind in ('category', 'number', 'date', 'text')),   -- null = detected from the values
  hidden      boolean not null default false,
  colors      jsonb not null default '{}',             -- {"jira": "--cat-3", "github_pr": "--cat-5"}
  updated_at  timestamptz not null default now(),
  primary key (corpus_name, field)
);

-- field settings are UI preferences, not results: they may change, and every change is logged
create function lab.log_field_style() returns trigger
language plpgsql as $$
begin
  perform lab.write_log('field.' || case tg_op when 'DELETE' then 'reset' else 'style' end,
    'field', coalesce(new.corpus_name, old.corpus_name) || '/' || coalesce(new.field, old.field), null,
    case when tg_op = 'INSERT' then null else to_jsonb(old) - 'updated_at' end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) - 'updated_at' end);
  return coalesce(new, old);
end $$;
create trigger log_change after insert or update or delete on lab.field_style
  for each row execute function lab.log_field_style();

-- ---------- reads ----------

create or replace view api.space_points as
select
  p.space_id, p.method, p.chunk_id, p.x, p.y, p.z,
  c.chunk_set_id, c.document_id, c.ord, c.char_start, c.char_end, c.token_count, c.text,
  (dense_rank() over (partition by p.space_id, p.method order by d.id) - 1)::int as doc_index,
  d.title as document_title, d.source, d.project,
  d.external_id as document_external_id, d.author, d.doc_date,
  d.metadata as document_metadata, c.metadata as chunk_metadata, p.cluster
from lab.projection p
join lab.chunk c on c.id = p.chunk_id
join lab.document d on d.id = c.document_id;

-- per projection method: how many points, and whether it is 3D and clustered
create view api.space_methods as
select space_id, method, count(*)::int as points, bool_and(z is not null) as has_z,
       bool_or(cluster is not null) as has_clusters,
       (array_agg(params))[1] as params
from lab.projection group by space_id, method;

create or replace view api.chunks as
select c.id, c.chunk_set_id, c.document_id, c.ord, c.char_start, c.char_end, c.token_count, c.parent_chunk_id,
       c.text, d.title as document_title, d.source, d.project, d.external_id as document_external_id, c.metadata
from lab.chunk c join lab.document d on d.id = c.document_id;

-- every ranked list of a run, without text: the Space page colours, filters and inspects with it
create view api.run_hits as
select h.run_id, h.question_id, h.stage, h.rank, h.chunk_id, h.score from lab.retrieval_hit h;

create view api.field_styles as select * from lab.field_style;

-- The k nearest chunks to a chunk in its embedding space, by cosine distance over the real vectors
-- (what a dense retriever sees), so the page can show how the 2D map distorts distances.
create function api.chunk_neighbours(space_id bigint, chunk_id bigint, k int default 10)
returns table (neighbour_id bigint, rank int, distance double precision)
language plpgsql stable security definer set search_path = lab, public, pg_temp
as $$
declare
  v_table text;
  v_type  text;
  v_vec   text;
begin
  select es.table_name, case when es.dim > 2000 then 'halfvec' else 'vector' end into v_table, v_type
  from lab.embedding_space es where es.id = chunk_neighbours.space_id;
  if v_table is null then
    raise exception 'embedding space % has no vector table', chunk_neighbours.space_id using errcode = 'no_data_found';
  end if;
  execute format('select embedding::text from %s where chunk_id = $1', v_table) into v_vec using chunk_neighbours.chunk_id;
  if v_vec is null then return; end if;   -- no vector for this chunk (yet)
  -- the vector is passed as a parameter, so the HNSW index can serve the ORDER BY ... LIMIT
  return query execute format(
    'select v.chunk_id, (row_number() over (order by v.d))::int, v.d from (
       select chunk_id, (embedding <=> $1::%2$s)::float8 as d from %1$s
       where chunk_id <> $2 order by embedding <=> $1::%2$s limit $3) v order by v.d',
    v_table, v_type)
  using v_vec, chunk_neighbours.chunk_id, least(greatest(coalesce(k, 10), 1), 50);
end $$;

grant select on api.space_points, api.space_methods, api.chunks, api.run_hits, api.field_styles to web_anon;
grant execute on function api.chunk_neighbours(bigint, bigint, int) to web_anon;

-- ---------- writes ----------

-- Sets how a field is shown. style = {"label": ..., "kind": ..., "hidden": ..., "colors": {...}};
-- keys left out keep their value, a JSON null clears one. An empty object {} resets the field.
create function api.set_field_style(corpus_name text, field text, style jsonb)
returns json
language plpgsql security definer set search_path = lab, pg_temp
as $$
declare
  s jsonb := coalesce(style, '{}');
  cur lab.field_style;
begin
  perform set_config('lab.actor', 'me', true);
  if coalesce(trim(set_field_style.corpus_name), '') = '' or coalesce(trim(set_field_style.field), '') = '' then
    raise exception 'a field style needs a corpus name and a field' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(s) <> 'object' then
    raise exception 'style must be a JSON object' using errcode = 'check_violation';
  end if;
  if s ? 'colors' and jsonb_typeof(s -> 'colors') not in ('object', 'null') then
    raise exception 'colors must be an object of value -> colour' using errcode = 'check_violation';
  end if;

  if s = '{}'::jsonb then
    delete from lab.field_style f where f.corpus_name = set_field_style.corpus_name and f.field = set_field_style.field;
    return json_build_object('field', field, 'reset', true);
  end if;

  select * into cur from lab.field_style f
  where f.corpus_name = set_field_style.corpus_name and f.field = set_field_style.field;
  insert into lab.field_style as f (corpus_name, field, label, kind, hidden, colors, updated_at)
  values (
    set_field_style.corpus_name, set_field_style.field,
    case when s ? 'label' then nullif(trim(s ->> 'label'), '') else cur.label end,
    case when s ? 'kind' then s ->> 'kind' else cur.kind end,
    case when s ? 'hidden' then coalesce((s ->> 'hidden')::boolean, false) else coalesce(cur.hidden, false) end,
    case when s ? 'colors' then coalesce(lab.jsonb_deep_merge(coalesce(cur.colors, '{}'), s -> 'colors'), '{}')
         else coalesce(cur.colors, '{}') end,
    now())
  on conflict on constraint field_style_pkey do update
    set label = excluded.label, kind = excluded.kind, hidden = excluded.hidden, colors = excluded.colors,
        updated_at = excluded.updated_at
    where (f.label, f.kind, f.hidden, f.colors) is distinct from (excluded.label, excluded.kind, excluded.hidden, excluded.colors);
  -- back to everything detected: drop the row, so the field reads as unadjusted again
  delete from lab.field_style f
  where f.corpus_name = set_field_style.corpus_name and f.field = set_field_style.field
    and f.label is null and f.kind is null and not f.hidden and f.colors = '{}';
  return json_build_object('field', field, 'reset', not found);
end $$;

revoke execute on function api.set_field_style(text, text, jsonb) from public;
grant execute on function api.set_field_style(text, text, jsonb) to web_writer;

-- a spike may write chunk metadata and clusters (both are plain columns of rows it inserts)
grant select on lab.field_style to lab_backend;

-- migrate:down
drop function if exists api.set_field_style(text, text, jsonb);
drop function if exists api.chunk_neighbours(bigint, bigint, int);
drop view if exists api.field_styles, api.run_hits, api.space_methods, api.chunks;
create view api.chunks as
select c.id, c.chunk_set_id, c.document_id, c.ord, c.char_start, c.char_end, c.token_count, c.parent_chunk_id,
       c.text, d.title as document_title, d.source, d.project, d.external_id as document_external_id
from lab.chunk c join lab.document d on d.id = c.document_id;
grant select on api.chunks to web_anon;
drop view if exists api.space_points;
create view api.space_points as
select
  p.space_id, p.method, p.chunk_id, p.x, p.y, p.z,
  c.chunk_set_id, c.document_id, c.ord, c.char_start, c.char_end, c.token_count, c.text,
  (dense_rank() over (partition by p.space_id, p.method order by d.id) - 1)::int as doc_index,
  d.title as document_title, d.source, d.project
from lab.projection p
join lab.chunk c on c.id = p.chunk_id
join lab.document d on d.id = c.document_id;
grant select on api.space_points to web_anon;
drop table if exists lab.field_style;
drop function if exists lab.log_field_style();
alter table lab.projection drop column if exists cluster;
alter table lab.chunk drop column if exists metadata;
