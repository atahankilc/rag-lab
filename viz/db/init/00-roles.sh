#!/bin/bash
# Runs once, when the Postgres volume is first created.
# Creates the two LOGIN roles. Their passwords come from .env, so they stay out of migrations.
#   authenticator  PostgREST connects as this, then switches to web_anon / web_writer per request
#   lab_backend    future RAG spikes connect as this to write artifacts, runs and results
set -euo pipefail

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v auth_pw="$LAB_AUTHENTICATOR_PASSWORD" -v backend_pw="$LAB_BACKEND_PASSWORD" <<'SQL'
create role authenticator login noinherit password :'auth_pw';
create role lab_backend login password :'backend_pw';
SQL
