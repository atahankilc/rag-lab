-- Integrity tests: immutability, the run state machine, roles, artifact reuse, and configurable steps.
-- `make test-db`. Works on an empty database: it builds its own small fixture first. Everything
-- happens in one transaction that is rolled back, so nothing is kept.
-- Each line prints "ok", or the script stops with "FAIL".

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
begin;

-- Runs `stmt` and expects it to fail. Returns the database's error message.
create function pg_temp.must_fail(label text, stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % was allowed', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  return 'ok    ' || rpad(label, 52) || sqlerrm;
end $$;

create function pg_temp.must_pass(label text, stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok    ' || label;
exception when others then
  raise exception 'FAIL: % was rejected: %', label, sqlerrm;
end $$;

create function pg_temp.check(label text, cond boolean) returns text language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if;
  return 'ok    ' || label;
end $$;

-- ---------- fixture: one corpus, two chunkings, two versions, one finished run ----------

insert into lab.provider (id, name, kind, location) values ('test-local', 'Test provider', 'test', 'local');
select lab.ensure_corpus_version('test-corpus', md5('test-corpus')) as corpus \gset
insert into lab.document (corpus_version_id, external_id, title, text)
values (:corpus, 'a', 'Doc A', 'The p95 budget is 200 ms. Rollback is one command.'),
       (:corpus, 'b', 'Doc B', 'Load tests ran on Monday.');
select lab.ensure_chunk_set(:corpus, 'fixed', '{"strategy": "fixed", "size": 32}') as cs_a \gset
select lab.ensure_chunk_set(:corpus, 'sentences', '{"strategy": "sentence"}') as cs_b \gset
insert into lab.chunk (chunk_set_id, document_id, ord, char_start, char_end, text)
select cs, d.id, 0, 0, 25, substr(d.text, 1, 25)
from lab.document d, (values (:cs_a), (:cs_b)) x(cs) where d.corpus_version_id = :corpus;
select lab.ensure_eval_set('test-eval', '1', md5('test-eval')) as eval_set \gset
insert into lab.eval_question (eval_set_id, external_id, qtype, question)
values (:eval_set, 'q1', 'basic', 'What is the p95 budget?') returning id as q1 \gset
insert into lab.gold_evidence (question_id, document_id, char_start, char_end)
select :q1, id, 0, 25 from lab.document where corpus_version_id = :corpus and external_id = 'a';
select lab.create_embedding_space(:cs_a, 'test-local', 'test-model', 3, 'local') as space_a \gset
select lab.create_embedding_space(:cs_b, 'test-local', 'test-model', 3, 'local') as space_b \gset

select lab.ensure_experiment('test-a', 'Test A', null, 'first', :corpus, :cs_a, :space_a, :eval_set,
  '{"steps": [{"id": "dense", "kind": "retrieve", "top_k": 5}, {"id": "generate", "kind": "generate", "provider": "test-local"}]}') as exp_a \gset
select lab.ensure_experiment('test-b', 'Test B', :exp_a, 'second', :corpus, :cs_b, :space_b, :eval_set,
  '{"steps": [{"id": "dense", "kind": "retrieve", "top_k": 20},
              {"id": "rerank", "kind": "rerank", "provider": "test-local", "top_n": 5},
              {"id": "generate", "kind": "generate", "provider": "test-local"}]}') as exp_b \gset
update lab.experiment set is_baseline = true where id = :exp_a;

insert into lab.run (experiment_id, status) values (:exp_b, 'running') returning id as run_done \gset
insert into lab.question_result (run_id, question_id, answer, metrics, latency_ms, cost)
values (:run_done, :q1, '200 ms', '{"correctness": 1}', '{"dense": 10, "rerank": 50, "generate": 400, "total": 460}',
        '{"generate": 0.001}');
insert into lab.retrieval_hit (run_id, question_id, stage, rank, chunk_id, score)
select :run_done, :q1, 'rerank', 1, id, 0.9 from lab.chunk where chunk_set_id = :cs_b order by id limit 1;
insert into lab.run_metric (run_id, name, value) values (:run_done, 'correctness', 1);
update lab.run set status = 'done' where id = :run_done;

select '-- fixture ready';

-- ---------- artifacts are immutable ----------
select '-- artifacts are immutable';
select pg_temp.must_fail('update a chunk',             'update lab.chunk set text = ''x'' where chunk_set_id = ' || :cs_a);
select pg_temp.must_fail('delete a document',          'delete from lab.document where corpus_version_id = ' || :corpus);
select pg_temp.must_fail('truncate chunks',            'truncate lab.chunk cascade');
select pg_temp.must_fail('change a chunk set config',  'update lab.chunk_set set config = ''{}'' where id = ' || :cs_a);
select pg_temp.must_fail('update a gold span',         'update lab.gold_evidence set char_end = 30 where question_id = ' || :q1);
select pg_temp.must_fail('change an embedding model',  'update lab.embedding_space set model = ''other'' where id = ' || :space_a);
select pg_temp.must_pass('set build_stats once',       'update lab.embedding_space set build_stats = ''{"vectors": 2}'' where id = ' || :space_a);
select pg_temp.must_fail('overwrite build_stats',      'update lab.embedding_space set build_stats = ''{}'' where id = ' || :space_a);

-- ---------- versions ----------
select '-- versions: config frozen, baseline and status may change';
select pg_temp.must_fail('change a version''s config', 'update lab.experiment set config = ''{}'' where id = ' || :exp_b);
select pg_temp.must_fail('re-parent a version',        'update lab.experiment set parent_id = null where id = ' || :exp_b);
select pg_temp.must_fail('delete a version',           'delete from lab.experiment where id = ' || :exp_b);
select pg_temp.must_pass('archive a version',          'update lab.experiment set status = ''archived'' where id = ' || :exp_b);
select pg_temp.must_fail('pin a second baseline',      'update lab.experiment set is_baseline = true where id = ' || :exp_b);

-- ---------- steps ----------
select '-- steps are declared per version, and checked';
select pg_temp.must_fail('a step without a kind',
  format('select lab.ensure_experiment(''bad1'', ''x'', null, null, %s, %s, %s, %s, ''{"steps": [{"id": "s1"}]}'')', :corpus, :cs_a, :space_a, :eval_set));
select pg_temp.must_fail('two steps with the same id',
  format('select lab.ensure_experiment(''bad2'', ''x'', null, null, %s, %s, %s, %s, ''{"steps": [{"id": "s", "kind": "retrieve"}, {"id": "s", "kind": "rerank"}]}'')', :corpus, :cs_a, :space_a, :eval_set));
select pg_temp.must_fail('a reserved step id ("total")',
  format('select lab.ensure_experiment(''bad3'', ''x'', null, null, %s, %s, %s, %s, ''{"steps": [{"id": "total", "kind": "judge"}]}'')', :corpus, :cs_a, :space_a, :eval_set));
select pg_temp.must_fail('steps that are not a list',
  format('select lab.ensure_experiment(''bad4'', ''x'', null, null, %s, %s, %s, %s, ''{"steps": {"a": 1}}'')', :corpus, :cs_a, :space_a, :eval_set));
select pg_temp.check('step order is part of a version''s identity (reordered = new version)',
  lab.ensure_experiment('test-a-reordered', 'x', :exp_a, null, :corpus, :cs_a, :space_a, :eval_set,
    '{"steps": [{"id": "generate", "kind": "generate", "provider": "test-local"}, {"id": "dense", "kind": "retrieve", "top_k": 5}]}') <> :exp_a);
select pg_temp.check('an unknown step kind is accepted (it renders with defaults)',
  lab.ensure_experiment('test-new-kind', 'x', :exp_a, null, :corpus, :cs_a, :space_a, :eval_set,
    '{"steps": [{"id": "graph", "kind": "graph_lookup", "hops": 2}]}') is not null);

select pg_temp.check('config diff names the step and setting: steps.dense.top_k',
  exists (select 1 from api.config_diff(:exp_a, :exp_b) where path = 'steps.dense.top_k' and a_value = '5' and b_value = '20'));
select pg_temp.check('config diff sees the new step: steps.rerank.*',
  exists (select 1 from api.config_diff(:exp_a, :exp_b) where path = 'steps.rerank.top_n' and a_value is null));
select pg_temp.check('config diff sees the order: step_order',
  exists (select 1 from api.config_diff(:exp_a, :exp_b) where path = 'step_order'));
select pg_temp.check('the timeline names changed steps, not "steps"',
  (select changed_keys from api.experiments where id = :exp_b) @> array['dense', 'rerank', 'step order']);
select pg_temp.check('step summary: library first, then the version''s steps in order',
  (select array_agg(step_id order by ord) from api.step_summary where experiment_id = :exp_b)
    = array['ingest', 'chunk', 'embed', 'dense', 'rerank', 'generate']);
select pg_temp.check('step summary: per-step latency and cost from the latest run',
  (select p50_ms = 50 from api.step_summary where experiment_id = :exp_b and step_id = 'rerank')
  and (select cost_usd = 0.001 from api.step_summary where experiment_id = :exp_b and step_id = 'generate'));
select pg_temp.check('provider spend is attributed through the step''s provider',
  (select spent_usd = 0.001 from api.providers where id = 'test-local'));

-- ---------- overrides ----------
select '-- run overrides address steps by id';
select pg_temp.check('change one setting',
  lab.apply_overrides('{"steps": [{"id": "r", "kind": "rerank", "top_n": 5}]}', '{"steps": {"r": {"top_n": 8}}}')
    = '{"steps": [{"id": "r", "kind": "rerank", "top_n": 8}]}');
select pg_temp.check('add a step (at the end)',
  lab.apply_overrides('{"steps": [{"id": "d", "kind": "retrieve"}]}', '{"steps": {"h": {"kind": "hyde"}}}') -> 'steps' -> 1 ->> 'id' = 'h');
select pg_temp.check('remove a step with null',
  jsonb_array_length(lab.apply_overrides('{"steps": [{"id": "d", "kind": "retrieve"}, {"id": "r", "kind": "rerank"}]}',
                                         '{"steps": {"r": null}}') -> 'steps') = 1);
select pg_temp.check('reorder with step_order',
  (select array_agg(s ->> 'id' order by i) from jsonb_array_elements(
     lab.apply_overrides('{"steps": [{"id": "a", "kind": "x"}, {"id": "b", "kind": "y"}]}', '{"step_order": ["b", "a"]}') -> 'steps')
     with ordinality t(s, i)) = array['b', 'a']);
select pg_temp.check('other settings deep-merge as usual',
  lab.apply_overrides('{"advanced": {"a": 1, "b": 2}}', '{"advanced": {"b": 3}}') = '{"advanced": {"a": 1, "b": 3}}');
insert into lab.run (experiment_id, overrides) values (:exp_b, '{"steps": {"hyde": {"kind": "hyde"}}, "step_order": ["hyde", "dense", "rerank", "generate"]}')
returning id as run_q \gset
select pg_temp.check('run progress follows the run''s own steps',
  (select array_agg(s ->> 'stage' order by i) from api.run_progress, jsonb_array_elements(stages) with ordinality t(s, i) where run_id = :run_q)
    = array['ingest', 'chunk', 'embed', 'index', 'hyde', 'dense', 'rerank', 'generate']);

-- ---------- runs ----------
select '-- runs: queued -> running -> done | failed, then frozen';
select pg_temp.must_fail('edit a finished run',         'update lab.run set total_cost_usd = 0 where id = ' || :run_done);
select pg_temp.must_fail('add a result to a done run',  format('insert into lab.question_result (run_id, question_id) values (%s, %s)', :run_done, :q1));
select pg_temp.must_fail('create a run as done',        'insert into lab.run (experiment_id, status) values (' || :exp_b || ', ''done'')');
select pg_temp.must_fail('jump from queued to done',    'update lab.run set status = ''done'' where id = ' || :run_q);
select pg_temp.must_fail('edit a stored result',        'update lab.question_result set answer = ''x'' where run_id = ' || :run_done);
select pg_temp.must_fail('delete a retrieval hit',      'delete from lab.retrieval_hit where run_id = ' || :run_done);

-- ---------- log ----------
select '-- the log is append-only';
select pg_temp.must_fail('edit a log row',              'update lab.log_event set note = ''x'' where id = (select min(id) from lab.log_event)');
select pg_temp.must_fail('delete a log row',            'delete from lab.log_event where id = (select min(id) from lab.log_event)');
select pg_temp.must_fail('truncate the log',            'truncate lab.log_event');
select pg_temp.check('writes were logged (version created, run done, baseline pinned)',
  (select count(distinct action) from lab.log_event where experiment_id = :exp_b and action in ('experiment.create', 'run.done')) = 2
  and exists (select 1 from lab.log_event where experiment_id = :exp_a and action = 'baseline.pin'));

-- ---------- roles ----------
select '-- roles';
select pg_temp.must_fail('web_anon reads a lab table',   'set local role web_anon; select count(*) from lab.chunk');
select pg_temp.must_pass('web_anon reads an api view',   'set local role web_anon; select count(*) from api.experiments');
select pg_temp.must_fail('web_anon queues a run',        'set local role web_anon; select api.queue_run(1, ''{}'')');
select pg_temp.must_fail('lab_backend deletes a chunk',  'set local role lab_backend; delete from lab.chunk where id = 1');
select pg_temp.must_fail('lab_backend loads providers',  'set local role lab_backend; select lab.load_providers(''{}'')');
reset role;

select '-- writes through the api are logged as "me"';
set local role web_writer;
select pg_temp.must_pass('web_writer queues a run with a step override',
  format('select api.queue_run(%s, ''{"steps": {"rerank": {"top_n": 10}}}'')', :exp_b));
reset role;
select pg_temp.check('queue_run wrote a log_event by me',
  exists (select 1 from lab.log_event where action = 'run.queue' and actor = 'me'
          and after -> 'overrides' -> 'steps' -> 'rerank' ->> 'top_n' = '10'));
set local role web_writer;
select pg_temp.must_pass('web_writer pins test-b as baseline', format('select api.set_baseline(%s, true)', :exp_b));
reset role;
select pg_temp.check('exactly one baseline, and it is test-b', (select array_agg(slug) from lab.experiment where is_baseline) = array['test-b']);

-- ---------- space ----------
select '-- space: field settings, true neighbours';
set local role web_writer;
select pg_temp.must_pass('web_writer styles a field',
  'select api.set_field_style(''test-corpus'', ''document.source'', ''{"label": "Origin", "colors": {"jira": "--cat-3"}}'')');
select pg_temp.must_pass('a second change keeps the label and merges colours',
  'select api.set_field_style(''test-corpus'', ''document.source'', ''{"colors": {"slack": "--cat-5"}}'')');
reset role;
select pg_temp.check('the field has its label and both colours',
  (select label = 'Origin' and colors = '{"jira": "--cat-3", "slack": "--cat-5"}' from api.field_styles
   where corpus_name = 'test-corpus' and field = 'document.source'));
set local role web_writer;
select pg_temp.must_pass('null clears one colour', 'select api.set_field_style(''test-corpus'', ''document.source'', ''{"colors": {"jira": null}}'')');
select pg_temp.must_fail('an unknown field type',  'select api.set_field_style(''test-corpus'', ''x'', ''{"kind": "colour"}'')');
select pg_temp.must_pass('{} resets the field',    'select api.set_field_style(''test-corpus'', ''document.source'', ''{}'')');
reset role;
select pg_temp.check('field changes were logged as me (style, style, style, reset)',
  (select array_agg(action order by id) from lab.log_event where target_type = 'field' and actor = 'me'
   and target_id like 'test-corpus/%')
    = array['field.style', 'field.style', 'field.style', 'field.reset']);
select pg_temp.must_fail('web_anon styles a field', 'set local role web_anon; select api.set_field_style(''c'', ''f'', ''{"hidden": true}'')');
reset role;

select table_name as emb_a from lab.embedding_space where id = :space_a \gset
insert into :emb_a (chunk_id, embedding)
select id, case when ord = 0 and document_id = (select min(document_id) from lab.chunk where chunk_set_id = :cs_a)
                then '[1,0,0]' else '[0.9,0.1,0]' end::vector
from lab.chunk where chunk_set_id = :cs_a;
select pg_temp.check('true neighbours come from the vectors, nearest first, without the chunk itself',
  (select count(*) = 1 and min(rank) = 1 and min(distance) >= 0
   from api.chunk_neighbours(:space_a, (select min(id) from lab.chunk where chunk_set_id = :cs_a), 5)));
select pg_temp.must_pass('web_anon may ask for neighbours',
  format('set local role web_anon; select * from api.chunk_neighbours(%s, 1)', :space_a));
reset role;

-- ---------- reuse ----------
select '-- identical work is reused (content addressing)';
select pg_temp.check('same chunking of the same corpus -> same chunk_set',
  lab.ensure_chunk_set(:corpus, 'renamed', '{"size": 32, "strategy": "fixed"}') = :cs_a);
select pg_temp.check('key order and nulls do not change the hash',
  lab.config_hash('1', '{"a": 1, "b": 2, "c": null}') = lab.config_hash('1', '{"b": 2, "a": 1}'));
select pg_temp.check('same chunks + same model -> same embedding space',
  lab.create_embedding_space(:cs_a, 'test-local', 'test-model', 3, 'local') = :space_a);
select pg_temp.check('the same version config -> the same version (whatever the slug)',
  lab.ensure_experiment('another-slug', 'x', null, null, :corpus, :cs_a, :space_a, :eval_set,
    '{"steps": [{"kind": "retrieve", "id": "dense", "top_k": 5}, {"provider": "test-local", "id": "generate", "kind": "generate"}]}') = :exp_a);
select pg_temp.must_fail('a version mixing artifacts from different chunk sets',
  format('select lab.ensure_experiment(''bad5'', ''x'', null, null, %s, %s, %s, %s, ''{}'')', :corpus, :cs_a, :space_b, :eval_set));

select '-- a version may skip part of the library';
select lab.ensure_experiment('test-closed-book', 'Closed book', null, 'no retrieval', :corpus, null, null, :eval_set,
  '{"steps": [{"id": "generate", "kind": "generate", "provider": "test-local"}]}') as exp_cb \gset
select pg_temp.check('closed-book again -> the same version',
  lab.ensure_experiment('test-closed-book-2', 'x', null, null, :corpus, null, null, :eval_set,
    '{"steps": [{"id": "generate", "kind": "generate", "provider": "test-local"}]}') = :exp_cb);
select pg_temp.must_pass('a lexical version: chunks, no vectors',
  format('select lab.ensure_experiment(''test-bm25'', ''x'', null, null, %s, %s, null, %s, ''{"steps": [{"id": "bm25", "kind": "retrieve", "method": "bm25"}]}'')', :corpus, :cs_a, :eval_set));
select pg_temp.must_fail('an embedding space without a chunk set',
  format('select lab.ensure_experiment(''bad6'', ''x'', null, null, %s, null, %s, %s, ''{}'')', :corpus, :space_a, :eval_set));
select pg_temp.check('a closed-book version is on the timeline',
  exists (select 1 from api.experiments where id = :exp_cb and chunk_set_id is null));
select pg_temp.check('its detail has no chunk set or embedding space',
  (select chunk_set is null and embedding_space is null and not (config ? 'chunking') and not (config ? 'embedding')
   from api.experiment_detail where id = :exp_cb));
select pg_temp.check('its pipeline is ingest + its own steps',
  (select array_agg(step_id order by ord) from api.step_summary where experiment_id = :exp_cb) = array['ingest', 'generate']);
select pg_temp.check('a diff to a version with vectors lists chunking and embedding',
  (select count(*) from api.config_diff(:exp_cb, :exp_a) where path like 'chunking.%' or path like 'embedding.%') > 0);

select '-- relevance survives rechunking';
select pg_temp.check('the question has a relevant chunk in both chunk sets',
  (select count(distinct chunk_set_id) from api.relevant_chunks where question_id = :q1) = 2);

-- ---------- logging in ----------
select '-- logging in: only the dev server''s web_auth role can, sessions last 30 days';
select pg_temp.check('a user is added (names are lower-cased)', lab.set_web_user(' Tester ', 'correct horse') = 'tester');
select pg_temp.must_fail('a password shorter than 8 characters', 'select lab.set_web_user(''tester'', ''short'')');
select pg_temp.must_fail('web_anon logs in',          'set local role web_anon; select api.login(''tester'', ''correct horse'')');
reset role;
select pg_temp.must_fail('web_writer logs in',        'set local role web_writer; select api.login(''tester'', ''correct horse'')');
reset role;
select pg_temp.must_fail('web_anon reads the users',  'set local role web_anon; select * from lab.web_user');
reset role;
select pg_temp.must_fail('lab_backend reads the users', 'set local role lab_backend; select * from lab.web_user');
reset role;
set local role web_auth;
select pg_temp.check('a wrong password gets nothing',  api.login('tester', 'wrong horse') is null);
select pg_temp.check('an unknown user gets nothing',   api.login('nobody', 'correct horse') is null);
select api.login('Tester', 'correct horse') ->> 'token' as session_token \gset
select pg_temp.check('the session names the user and ends in 30 days',
  (select (s ->> 'username') = 'tester'
      and (s ->> 'expires_at')::timestamptz between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
   from api.web_session(:'session_token') s));
select pg_temp.check('an unknown token has no session', api.web_session('not-a-token') is null);
select pg_temp.must_fail('web_auth queues a run', 'select api.queue_run(1, ''{}'')');
reset role;
select pg_temp.check('only a hash of the token is stored',
  not exists (select 1 from lab.web_session where token_hash = :'session_token'));
update lab.web_session set expires_at = now() - interval '1 second' where username = 'tester';
set local role web_auth;
select pg_temp.check('an expired session is gone', api.web_session(:'session_token') is null);
select api.login('tester', 'correct horse') ->> 'token' as session_token \gset
select pg_temp.must_pass('web_auth logs out', format('select api.logout(%L)', :'session_token'));
select pg_temp.check('logging out ends the session', api.web_session(:'session_token') is null);
reset role;

rollback;
select 'all integrity tests passed';
