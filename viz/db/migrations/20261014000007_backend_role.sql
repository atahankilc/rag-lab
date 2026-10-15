-- What a RAG spike (connected as lab_backend) may do, and two helpers so every language does the
-- tricky steps the same, safe way. See docs/backend-contract.md.
--
--   read everything in lab and api; insert artifacts / versions / runs / results / events;
--   move its runs forward; set an embedding space's build_stats once. No DELETE anywhere, and the
--   triggers still enforce immutability.
--
--   lab.ensure_experiment(...)  find or create a version by its config hash
--   lab.claim_run(worker, ...)  atomically take the oldest queued run (two workers never get the same one)

-- migrate:up

grant select on all tables in schema lab to lab_backend;
grant insert on
  lab.corpus_version, lab.document, lab.chunk_set, lab.chunk, lab.projection, lab.query_projection,
  lab.eval_set, lab.eval_question, lab.gold_evidence,
  lab.experiment, lab.experiment_note, lab.run, lab.question_result, lab.retrieval_hit, lab.run_metric,
  lab.run_event, lab.log_event
to lab_backend;
-- embedding_space rows are created through lab.create_embedding_space (it also creates emb_<id>)
grant update (build_stats) on lab.embedding_space to lab_backend;
grant update (status, started_at, finished_at, total_cost_usd, stage_cost, git_commit, environment, worker, error)
  on lab.run to lab_backend;
grant usage on all sequences in schema lab to lab_backend;

-- a spike may read what the UI reads (the api views), e.g. to check its own results
grant web_anon to lab_backend;

create function lab.ensure_experiment(
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

-- Claims the oldest queued run (optionally of one version) and marks it running.
-- Returns no row when nothing is queued. SKIP LOCKED makes concurrent claims safe.
create function lab.claim_run(
  p_worker text, p_experiment_id bigint default null,
  p_git_commit text default null, p_environment jsonb default '{}'
) returns setof lab.run
language sql as $$
  update lab.run r
  set status = 'running', worker = p_worker, started_at = now(),
      git_commit = coalesce(p_git_commit, r.git_commit),
      environment = r.environment || coalesce(p_environment, '{}')
  where r.id = (
    select q.id from lab.run q
    where q.status = 'queued' and (p_experiment_id is null or q.experiment_id = p_experiment_id)
    order by q.queued_at, q.id
    for update skip locked
    limit 1
  )
  returning r.*
$$;

grant execute on function lab.ensure_experiment(text, text, bigint, text, bigint, bigint, bigint, bigint, jsonb) to lab_backend;
grant execute on function lab.claim_run(text, bigint, text, jsonb) to lab_backend;

-- migrate:down
drop function if exists lab.claim_run(text, bigint, text, jsonb);
drop function if exists lab.ensure_experiment(text, text, bigint, text, bigint, bigint, bigint, bigint, jsonb);
revoke web_anon from lab_backend;
revoke all on all tables in schema lab from lab_backend;
revoke all on all sequences in schema lab from lab_backend;
