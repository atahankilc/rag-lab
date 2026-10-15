-- Foundation: extensions, schemas, API roles, and the config-hash helper.
--
--   lab  tables and internal functions (only the owner and lab_backend touch it)
--   api  views + functions that PostgREST serves to the UI (the only thing the UI sees)

-- migrate:up
create extension if not exists vector;

create schema lab;
create schema api;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'web_anon') then
    create role web_anon nologin;      -- read role: every GET from the UI
  end if;
  if not exists (select 1 from pg_roles where rolname = 'web_writer') then
    create role web_writer nologin;    -- write role: the few RPCs the UI may call
  end if;
  if not exists (select 1 from pg_roles where rolname = 'lab_backend') then
    create role lab_backend nologin;   -- normally created with a password by init/00-roles.sh
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant web_anon, web_writer to authenticator;
  end if;
end $$;

grant web_anon to web_writer;          -- the writer can also read everything the reader can

-- JIT compiles plans to machine code; it pays off for big analytic scans, not for small API views,
-- where it added ~0.8 s of compile time to every request.
do $$ begin execute format('alter database %I set jit = off', current_database()); end $$;

grant usage on schema api to web_anon;
grant usage on schema lab to web_anon, lab_backend;

-- Content addressing. An artifact's identity is a sha256 of its parent identity plus its
-- normalised config. Normalising = dropping null keys; jsonb already sorts keys and drops
-- whitespace, so {"b":1,"a":2} and {"a": 2, "b": 1} hash the same.
create function lab.config_hash(parent text, config jsonb)
returns text
language sql immutable parallel safe
as $$
  select encode(sha256(convert_to(
    coalesce(parent, '') || '|' || jsonb_strip_nulls(coalesce(config, '{}'::jsonb))::text,
    'UTF8')), 'hex')
$$;

-- migrate:down
drop function if exists lab.config_hash(text, jsonb);
drop schema if exists api cascade;
drop schema if exists lab cascade;
