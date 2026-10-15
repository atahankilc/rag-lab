-- The backend contract, executed: every step of docs/backend-contract.md, connected as lab_backend
-- (the role a real spike uses). Runs in one transaction and rolls back, so it changes nothing.
-- `make test-contract`. Needs the providers from viz/providers.json (make providers); no other data.
-- Stops at the first failure.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
begin;
select 'connected as ' || current_user;
-- a spike uses a provider from viz/providers.json; any local one will do here
select coalesce((select id from lab.provider where location = 'local' order by id limit 1),
                (select id from lab.provider order by id limit 1)) as provider \gset
select 'using provider ' || :'provider';

-- 1. Find or create the artifacts ------------------------------------------------------------

select lab.ensure_corpus_version('contract-corpus', encode(sha256('doc-a|doc-b'), 'hex'),
                                 '{"origin": "contract test", "documents": 2}') as corpus \gset
select lab.ensure_corpus_version('contract-corpus', encode(sha256('doc-a|doc-b'), 'hex')) = :corpus as corpus_reused \gset
select 'step 1  corpus ' || :corpus || ', reused on second call: ' || :'corpus_reused';

insert into lab.document (corpus_version_id, external_id, source, title, project, text, content_hash) values
  (:corpus, 'doc-a', 'confluence', 'Atlas runbook', 'atlas',
   'The p95 latency budget for Atlas is 200 ms. Rollback is one command.', 'doc-a'),
  (:corpus, 'doc-b', 'slack', 'Atlas thread', 'atlas',
   'Load tests ran on Monday. The gateway peaks on Monday mornings.', 'doc-b');

select lab.ensure_chunk_set(:corpus, 'sentences', '{"strategy": "sentence", "size": 1, "overlap": 0}') as cs \gset
select lab.ensure_chunk_set(:corpus, 'renamed', '{"overlap": 0, "strategy": "sentence", "size": 1}') = :cs as cs_reused \gset
select '        chunk set ' || :cs || ', same config with other key order reused: ' || :'cs_reused';

insert into lab.chunk (chunk_set_id, document_id, ord, char_start, char_end, token_count, text, metadata)
select :cs, d.id, c.ord, c.s, c.e, (c.e - c.s) / 4, substr(d.text, c.s + 1, c.e - c.s),
       jsonb_build_object('sentence', c.ord + 1)                  -- optional: anything that describes the chunk
from lab.document d
join (values ('doc-a', 0, 0, 43), ('doc-a', 1, 44, 68), ('doc-b', 0, 0, 25), ('doc-b', 1, 26, 63)) c(doc, ord, s, e)
  on d.external_id = c.doc
where d.corpus_version_id = :corpus;

select lab.ensure_eval_set('contract-eval', '1', encode(sha256('q1'), 'hex')) as eval_set \gset
insert into lab.eval_question (eval_set_id, external_id, qtype, tags, question, gold_answer)
values (:eval_set, 'q1', 'basic', '{basic}', 'What is the p95 latency budget for Atlas?', '200 ms.')
returning id as q1 \gset
insert into lab.gold_evidence (question_id, document_id, char_start, char_end)
select :q1, id, 0, 43 from lab.document where corpus_version_id = :corpus and external_id = 'doc-a';

select lab.create_embedding_space(:cs, :'provider', 'contract-model', 3, 'local', '{"normalize": true}') as space \gset
select table_name as emb_table from lab.embedding_space where id = :space \gset
select '        embedding space ' || :space || ' -> ' || :'emb_table';

-- 2. Vectors and projections --------------------------------------------------------------------

insert into :emb_table (chunk_id, embedding)
select c.id, ('[' || (0.1 * c.ord + 0.1) || ',' || case when d.external_id = 'doc-a' then 0.5 else 0.1 end || ',' ||
              (0.2 * c.ord) || ']')::vector      -- stand-in vectors; a spike writes real ones
from lab.chunk c join lab.document d on d.id = c.document_id where c.chunk_set_id = :cs;
update lab.embedding_space set build_stats = '{"vectors": 4, "build_ms": 120, "index_bytes": 9000}' where id = :space;

insert into lab.projection (space_id, method, chunk_id, x, y, params, cluster)
select :space, 'umap', c.id, c.ord * 0.5 - 0.25, case when d.external_id = 'doc-a' then 0.3 else -0.3 end, '{"n_neighbors": 2}',
       case when d.external_id = 'doc-a' then 0 else 1 end      -- optional cluster id (e.g. HDBSCAN)
from lab.chunk c join lab.document d on d.id = c.document_id where c.chunk_set_id = :cs;
insert into lab.query_projection (space_id, method, question_id, x, y) values (:space, 'umap', :q1, -0.2, 0.25);
-- optional: more methods, and 3D (fill z)
insert into lab.projection (space_id, method, chunk_id, x, y, z)
select :space, 'pca', c.id, c.ord - 0.5, case when d.external_id = 'doc-a' then 1 else -1 end, c.ord * 0.3
from lab.chunk c join lab.document d on d.id = c.document_id where c.chunk_set_id = :cs;
insert into lab.query_projection (space_id, method, question_id, x, y, z) values (:space, 'pca', :q1, -0.4, 0.8, 0);
select '        projections: ' || string_agg(method || ' ' || points || ' points' || case when has_z then ' 3D' else ' 2D' end ||
       case when has_clusters then ', clustered' else '' end, '; ' order by method)
from api.space_methods where space_id = :space;
select '        true neighbours of the first chunk: ' || string_agg(rank || '. ' || round(distance::numeric, 3), ', ' order by rank)
from api.chunk_neighbours(:space, (select min(id) from lab.chunk where chunk_set_id = :cs), 3);

select 'step 2  ' || count(*) || ' vectors, nearest to the query vector: ' ||
       (select c.text from :emb_table v join lab.chunk c on c.id = v.chunk_id order by v.embedding <=> '[0.1,0.5,0]' limit 1)
from :emb_table;

-- 3. The version (experiment) ---------------------------------------------------------------------

select format('{"steps": [
    {"id": "dense",    "kind": "retrieve", "method": "dense", "top_k": 2},
    {"id": "generate", "kind": "generate", "provider": "%1$s", "model": "contract-llm", "temperature": 0},
    {"id": "judge",    "kind": "judge",    "provider": "%1$s", "model": "contract-judge"}]}', :'provider') as config \gset
select lab.ensure_experiment('contract-v1', 'Contract test', null,
  'Proves a spike can register itself.', :corpus, :cs, :space, :eval_set, :'config') as exp \gset
select lab.ensure_experiment('contract-v1-again', 'Same config', null, null, :corpus, :cs, :space, :eval_set,
  :'config') = :exp as exp_reused \gset
select 'step 3  experiment ' || :exp || ', identical config reused: ' || :'exp_reused';

-- 4. Claim a queued run (the UI's "Queue run" creates these) --------------------------------------

insert into lab.run (experiment_id, overrides) values (:exp, '{"steps": {"dense": {"top_k": 3}}}');
select id as run, status as run_status, overrides as run_overrides from lab.claim_run('contract-spike', :exp, 'abc1234', '{"python": "3.12"}') \gset
select 'step 4  claimed run ' || :run || ' -> ' || :'run_status' || ', overrides ' || :'run_overrides';
select '        effective steps: ' || (select string_agg((s ->> 'id') || coalesce(' top_k=' || (s ->> 'top_k'), ''), ' -> ')
  from jsonb_array_elements(lab.apply_overrides((select config from lab.experiment where id = :exp), :'run_overrides') -> 'steps') s);
select count(*) = 0 as nothing_left from lab.claim_run('another-worker', :exp) \gset
select '        a second worker gets nothing: ' || :'nothing_left';

-- 5. Stream events ------------------------------------------------------------------------------------

insert into lab.run_event (run_id, stage, level, message, data) values
  (:run, 'ingest',   'info', 'corpus reused',             '{"state": "done"}'),
  (:run, 'chunk',    'info', 'chunk set reused',          '{"state": "done"}'),
  (:run, 'embed',    'info', '4 vectors written',         '{"state": "done"}'),
  (:run, 'index',    'info', 'HNSW index ready',          '{"state": "done"}'),
  (:run, 'dense',    'info', 'retrieved for 1 question',  '{"state": "done", "done": 1, "total": 1}'),
  (:run, 'generate', 'info', 'answered 1 of 1',           '{"state": "done", "done": 1, "total": 1}'),
  (:run, 'judge',    'info', 'judged 1 answer',           '{"state": "done", "done": 1, "total": 1}');
select 'step 5  ' || count(*) || ' events' from lab.run_event where run_id = :run;

-- 6. Results ------------------------------------------------------------------------------------------

insert into lab.retrieval_hit (run_id, question_id, stage, rank, chunk_id, score)
select :run, :q1, 'dense', row_number() over (order by v.embedding <=> '[0.1,0.5,0]'), v.chunk_id,
       1 - (v.embedding <=> '[0.1,0.5,0]')
from :emb_table v
order by v.embedding <=> '[0.1,0.5,0]' limit 3;

insert into lab.question_result (run_id, question_id, answer, citations, metrics, latency_ms, tokens, cost, cost_usd, judge_rationale)
select :run, :q1, '200 ms [1]',
  jsonb_build_array(jsonb_build_object('marker', '[1]', 'chunk_id', h.chunk_id, 'rank', 1)),
  '{"correctness": 1, "faithfulness": 0.95, "recall_at_k": 1, "mrr": 1, "my_new_metric": 0.42}',
  '{"dense": 24, "generate": 610, "judge": 900, "total": 634}',
  '{"prompt": 300, "completion": 12, "judge": 1100}',
  '{"dense": 0, "generate": 0.0001, "judge": 0.003}', 0.0001, 'Matches the gold answer.'
from lab.retrieval_hit h where h.run_id = :run and h.question_id = :q1 and h.rank = 1;

insert into lab.run_metric (run_id, name, scope, value) values
  (:run, 'correctness', 'all', 1), (:run, 'recall_at_k', 'all', 1), (:run, 'mrr', 'all', 1),
  (:run, 'my_new_metric', 'all', 0.42), (:run, 'latency_p50_ms', 'all', 634), (:run, 'correctness', 'tag:basic', 1);
select 'step 6  ' || (select count(*) from lab.retrieval_hit where run_id = :run) || ' hits, ' ||
       (select count(*) from lab.question_result where run_id = :run) || ' result, ' ||
       (select count(*) from lab.run_metric where run_id = :run) || ' metrics';

-- 7. Done ---------------------------------------------------------------------------------------------

update lab.run set status = 'done', total_cost_usd = 0.0031,
  stage_cost = '{"generate": 0.0001, "judge": 0.003}' where id = :run;
select 'step 7  run ' || status || ' at ' || to_char(finished_at, 'HH24:MI:SS') from lab.run where id = :run;

-- What the UI now shows (read through the same api views PostgREST serves) --------------------------

select 'ui      timeline: ' || slug || ', steps ' || step_ids::text || ', ' ||
       'correctness ' || (metrics ->> 'correctness') || ', unknown metric my_new_metric = ' || (metrics ->> 'my_new_metric')
from api.experiments where id = :exp;
select 'ui      relevant chunk retrieved at rank 1: ' || relevant from api.retrieval_hits where run_id = :run and rank = 1;
select 'ui      run progress: ' || string_agg((s ->> 'stage') || '=' || (s ->> 'state'), ' ') from api.run_progress, jsonb_array_elements(stages) s where run_id = :run;
select 'ui      pipeline page: ' || string_agg(step_id || ' ' || coalesce(round(p50_ms)::text || 'ms', '-'), ' -> ' order by ord)
from api.step_summary where experiment_id = :exp;
select 'ui      log: ' || string_agg(action, ', ' order by id) from lab.log_event where experiment_id = :exp;

-- and the guarantees still hold for this role
do $$ begin
  update lab.question_result set answer = 'edited' where answer = '200 ms [1]';
  raise exception 'FAIL: a finished result could be edited';
exception when restrict_violation or insufficient_privilege then null; end $$;
select 'rules   results cannot be edited (no UPDATE grant, and the immutability trigger behind it): ok';

rollback;
select 'contract test passed (rolled back, nothing kept)';
