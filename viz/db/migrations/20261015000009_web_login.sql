-- Logging in to the UI. Without a session the UI is read-only; with one it may write.
--
--   lab.web_user     who may log in. There is no sign-up: `make user NAME=...` adds or updates one.
--   lab.web_session  one row per login, kept for 30 days. Only a sha256 of the token is stored.
--   web_auth         a role only the UI's dev server takes (it signs its own short JWT for it). It can
--                    log in, look up a session and log out, nothing else. web_anon can't, so the browser
--                    never sees a session token in JSON: the dev server keeps it in an HttpOnly cookie.
--
-- The write RPCs themselves don't change: the dev server only adds the web_writer token to a write
-- when the request's cookie names a live session (frontend/vite.auth.ts).

-- migrate:up
create extension if not exists pgcrypto schema public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'web_auth') then
    create role web_auth nologin;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant web_auth to authenticator;
  end if;
end $$;
grant usage on schema api to web_auth;

create table lab.web_user (
  username      text primary key check (username ~ '^[a-z0-9_.-]{1,40}$'),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table lab.web_session (
  token_hash text primary key,
  username   text not null references lab.web_user on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on lab.web_session (expires_at);

create function lab.token_hash(token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex') $$;

-- Adds a user or sets a new password (which also ends their sessions). Owner only: `make user`.
create function lab.set_web_user(p_username text, p_password text) returns text
language plpgsql set search_path = lab, public, pg_temp as $$
declare v_name text := lower(trim(p_username));
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'a password needs at least 8 characters' using errcode = 'check_violation';
  end if;
  insert into lab.web_user (username, password_hash) values (v_name, crypt(p_password, gen_salt('bf', 10)))
  on conflict (username) do update set password_hash = excluded.password_hash;
  delete from lab.web_session s where s.username = v_name;
  return v_name;
end $$;

-- Returns {token, username, expires_at}, or null for a wrong username or password. An unknown user is
-- still checked against a fresh bcrypt salt, so both failures take as long.
create function api.login(username text, password text) returns json
language plpgsql security definer set search_path = lab, public, pg_temp as $$
declare
  v_name  text := lower(trim(login.username));
  v_hash  text;
  v_token text;
  v_exp   timestamptz := now() + interval '30 days';
begin
  delete from lab.web_session s where s.expires_at <= now();
  select u.password_hash into v_hash from lab.web_user u where u.username = v_name;
  if crypt(coalesce(login.password, ''), coalesce(v_hash, gen_salt('bf', 10))) is distinct from v_hash then
    return null;
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into lab.web_session (token_hash, username, expires_at) values (lab.token_hash(v_token), v_name, v_exp);
  return json_build_object('token', v_token, 'username', v_name, 'expires_at', v_exp);
end $$;

-- {username, expires_at} for a live session, otherwise null.
create function api.web_session(token text) returns json
language sql stable security definer set search_path = lab, pg_temp as $$
  select json_build_object('username', s.username, 'expires_at', s.expires_at)
  from lab.web_session s
  where s.token_hash = lab.token_hash(web_session.token) and s.expires_at > now()
$$;

create function api.logout(token text) returns void
language sql security definer set search_path = lab, pg_temp as $$
  delete from lab.web_session s where s.token_hash = lab.token_hash(logout.token)
$$;

revoke execute on function lab.set_web_user(text, text) from public;
revoke execute on function api.login(text, text) from public;
revoke execute on function api.web_session(text) from public;
revoke execute on function api.logout(text) from public;
grant execute on function api.login(text, text) to web_auth;
grant execute on function api.web_session(text) to web_auth;
grant execute on function api.logout(text) to web_auth;

-- migrate:down
drop function if exists api.logout(text);
drop function if exists api.web_session(text);
drop function if exists api.login(text, text);
drop function if exists lab.set_web_user(text, text);
drop function if exists lab.token_hash(text);
drop table if exists lab.web_session;
drop table if exists lab.web_user;
revoke usage on schema api from web_auth;
