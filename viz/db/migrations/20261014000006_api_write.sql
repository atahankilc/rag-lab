-- The write side of the api schema: the only things the UI can change, all as web_writer.
-- Each call marks itself as actor 'me'; the log triggers then write the log_event.

-- migrate:up

create function api.add_note(experiment_id bigint, body text)
returns json
language plpgsql security definer set search_path = lab, pg_temp
as $$
declare v_id bigint;
begin
  if coalesce(trim(add_note.body), '') = '' then
    raise exception 'a note needs a body' using errcode = 'check_violation';
  end if;
  insert into lab.experiment_note (experiment_id, body, actor)
  values (add_note.experiment_id, trim(add_note.body), 'me')
  returning id into v_id;
  return json_build_object('id', v_id);
end $$;

create function api.set_baseline(experiment_id bigint, pinned boolean default true)
returns json
language plpgsql security definer set search_path = lab, pg_temp
as $$
begin
  perform set_config('lab.actor', 'me', true);
  if not exists (select 1 from lab.experiment e where e.id = set_baseline.experiment_id) then
    raise exception 'experiment % does not exist', set_baseline.experiment_id using errcode = 'no_data_found';
  end if;
  if pinned then
    update lab.experiment e set is_baseline = false where e.is_baseline and e.id <> set_baseline.experiment_id;
    update lab.experiment e set is_baseline = true where e.id = set_baseline.experiment_id and not e.is_baseline;
  else
    update lab.experiment e set is_baseline = false where e.id = set_baseline.experiment_id and e.is_baseline;
  end if;
  return json_build_object('experiment_id', set_baseline.experiment_id, 'pinned', pinned);
end $$;

create function api.set_provider_enabled(provider_id text, enabled boolean)
returns json
language plpgsql security definer set search_path = lab, pg_temp
as $$
begin
  perform set_config('lab.actor', 'me', true);
  update lab.provider p set enabled = set_provider_enabled.enabled where p.id = set_provider_enabled.provider_id;
  if not found then
    raise exception 'provider % does not exist', set_provider_enabled.provider_id using errcode = 'no_data_found';
  end if;
  return json_build_object('provider_id', provider_id, 'enabled', enabled);
end $$;

-- cap_usd = null removes the cap.
create function api.set_provider_cap(provider_id text, cap_usd numeric)
returns json
language plpgsql security definer set search_path = lab, pg_temp
as $$
begin
  perform set_config('lab.actor', 'me', true);
  if cap_usd is not null and cap_usd < 0 then
    raise exception 'a spend cap cannot be negative' using errcode = 'check_violation';
  end if;
  update lab.provider p set spend_cap_usd = set_provider_cap.cap_usd where p.id = set_provider_cap.provider_id;
  if not found then
    raise exception 'provider % does not exist', set_provider_cap.provider_id using errcode = 'no_data_found';
  end if;
  return json_build_object('provider_id', provider_id, 'cap_usd', cap_usd);
end $$;

-- Puts a run in the queue. Nothing picks it up until a backend exists.
create function api.queue_run(experiment_id bigint, overrides jsonb default '{}', note text default null)
returns json
language plpgsql security definer set search_path = lab, pg_temp
as $$
declare v_id bigint;
begin
  perform set_config('lab.actor', 'me', true);
  if note is not null then perform set_config('lab.note', note, true); end if;
  if jsonb_typeof(coalesce(overrides, '{}')) <> 'object' then
    raise exception 'overrides must be a JSON object' using errcode = 'check_violation';
  end if;
  insert into lab.run (experiment_id, status, overrides)
  values (queue_run.experiment_id, 'queued', coalesce(overrides, '{}'))
  returning id into v_id;
  return json_build_object('run_id', v_id, 'status', 'queued');
end $$;

revoke execute on function api.add_note(bigint, text) from public;
revoke execute on function api.set_baseline(bigint, boolean) from public;
revoke execute on function api.set_provider_enabled(text, boolean) from public;
revoke execute on function api.set_provider_cap(text, numeric) from public;
revoke execute on function api.queue_run(bigint, jsonb, text) from public;
grant execute on function api.add_note(bigint, text) to web_writer;
grant execute on function api.set_baseline(bigint, boolean) to web_writer;
grant execute on function api.set_provider_enabled(text, boolean) to web_writer;
grant execute on function api.set_provider_cap(text, numeric) to web_writer;
grant execute on function api.queue_run(bigint, jsonb, text) to web_writer;

-- migrate:down
drop function if exists api.queue_run(bigint, jsonb, text);
drop function if exists api.set_provider_cap(text, numeric);
drop function if exists api.set_provider_enabled(text, boolean);
drop function if exists api.set_baseline(bigint, boolean);
drop function if exists api.add_note(bigint, text);
