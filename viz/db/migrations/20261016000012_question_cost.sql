-- The Questions page shows each step's cost next to its latency and tokens, so api.question_results also
-- returns the per-step cost (keyed by step id, like latency_ms and tokens). Added as the last column.

-- migrate:up

create or replace view api.question_results as
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
       else 'unchanged' end as verdict_baseline,
  r.cost
from res r
cross join primary_metric pm
join lab.experiment e on e.id = r.experiment_id
join lab.eval_question eq on eq.id = r.question_id
left join res pr on pr.experiment_id = e.parent_id and pr.question_id = r.question_id
left join lab.baseline b on true
left join res br on br.experiment_id = b.experiment_id and br.question_id = r.question_id;

-- migrate:down
-- create or replace can't drop a column: rebuild the view as it was (nothing else depends on it).
drop view api.question_results;
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
grant select on api.question_results to web_anon;
