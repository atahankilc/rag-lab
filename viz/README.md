# RAG Lab (viz/)

A local workbench that stores every version of the RAG system side by side, so they can be compared
on the same scale. This folder is the visualization side; the RAG implementation itself will live in
`../rag/` and only has to write into this database.

Status: **done**: database, all seven pages (Pipeline, Space, Questions, Compare, Runs, Providers, Log),
and the backend contract. A spike that follows [`docs/backend-contract.md`](docs/backend-contract.md) appears
in the UI with no frontend change. Design rules: [`docs/DESIGN_LANGUAGE.md`](docs/DESIGN_LANGUAGE.md).

## Setup

Needs Docker and uv. Nothing else is installed on the host: dbmate and psql run in containers.

```sh
cp .env.example .env      # then fill in the LAB_* values (openssl rand -hex 24)
make reset                # start Postgres + PostgREST, run migrations, load viz/providers.json
make test-db              # integrity tests (immutability, run states, roles, reuse)
make test-contract        # the backend contract, step by step, as the backend role (rolled back)
make dev                  # the UI on http://127.0.0.1:5173 (needs pnpm)
```

The UI calls PostgREST through the Vite dev server at `/api`. Reads go through as the read role;
writes get a short-lived `web_writer` JWT added by the dev server (`frontend/vite.config.ts`), so the
secret never reaches the browser. The selected version and reference live in the URL
(`/?v=v3&ref=baseline`), and every page follows them.

| Command        | What it does                                                        |
|----------------|---------------------------------------------------------------------|
| `make db`      | start Postgres 17 + pgvector (127.0.0.1:54329) and PostgREST (127.0.0.1:3301) |
| `make migrate` | apply `db/migrations/*.sql` with dbmate, then reload PostgREST       |
| `make providers` | load `providers.json` again after editing it (adds or updates; keeps on/off and caps) |
| `make reset`   | drop the volume and rebuild everything                               |
| `make test-db` | run `db/tests/integrity.sql` (rolled back, changes nothing)          |
| `make test-contract` | run `db/tests/contract.sql` as `lab_backend` (rolled back)     |
| `make dev`     | the UI on http://127.0.0.1:5173                                      |
| `make psql`    | a psql shell on the `lab` database                                   |
| `make token`   | a JWT for the write role, to try the RPCs with curl                  |

## How the database is organised

Two schemas:

- **`lab`**: the tables. Artifacts are immutable and content-addressed: a `config_hash`
  (sha256 of parent + normalised config) is UNIQUE, so the same chunking of the same corpus is
  stored once, and the same chunks + model get one embedding space (`lab.emb_<id>`, created by
  `lab.create_embedding_space`). Experiments point to artifacts; changing a config means a new
  experiment with `parent_id`. Finished runs, results and the log can't be changed (triggers).
- **`api`**: views and functions served by PostgREST. This is all the UI touches.

Roles:

| Role          | Used by                    | Can                                              |
|---------------|----------------------------|--------------------------------------------------|
| `web_anon`    | every UI read (no token)   | SELECT on `api` views                             |
| `web_writer`  | UI writes (JWT)            | + the 6 RPCs: `add_note`, `set_baseline`, `set_provider_enabled`, `set_provider_cap`, `queue_run`, `set_field_style` |
| `lab_backend` | future RAG spikes (SQL)    | insert artifacts/runs/results, move its runs forward; never delete |

Every write is logged to `lab.log_event` by triggers (actor `me` for the UI, `system` otherwise).

## Try it

```sh
curl -s '127.0.0.1:3301/providers?select=id,location,key_env,enabled'
curl -s '127.0.0.1:3301/step_defs?select=kind,phase,label'
curl -s '127.0.0.1:3301/experiments?select=slug,step_ids,changed_keys,metrics->correctness&order=ord'
curl -s -X POST 127.0.0.1:3301/rpc/set_provider_cap -H "Authorization: Bearer $(make -s token)" \
     -H 'Content-Type: application/json' -d '{"provider_id": "openai", "cap_usd": 10}'
```

## There is no demo data

A fresh database holds only the providers. Versions, runs and results appear when a spike writes them by
following [`docs/backend-contract.md`](docs/backend-contract.md). Until then the version pages say so, and
Runs, Providers and Log work as usual.

## The Space page is generic

The Space page doesn't know what the corpus is. It reads the fields a spike writes (document columns, any keys in
`document.metadata` and `chunk.metadata`, clusters, retrieval results), detects each one's type, and offers it
for colour, filters and the chunk inspector. How a field shows (name, type, hidden, colour per value) is edited on
the page and saved per corpus name in `lab.field_style`. True nearest neighbours come from
`api.chunk_neighbours`, a cosine search over the real vectors.

## Providers

[`providers.json`](providers.json) lists where models run. To add one, say Anthropic, add an entry and run
`make providers`:

```json
{
  "id": "anthropic", "name": "Anthropic", "kind": "anthropic", "location": "cloud",
  "endpoint": "https://api.anthropic.com", "key_env": "ANTHROPIC_API_KEY",
  "models": [{ "name": "<model id>", "kinds": ["generate", "judge"], "price_in_per_1m": null, "price_out_per_1m": null }]
}
```

The key itself goes in `.env` under the name given in `key_env`; the database never sees it. Prices are
`null` until you fill them in from the provider's pricing page; a spike can use them to compute costs.
`"defaults"` names the model each step kind uses when a version doesn't say.

## Pipelines are data

A version declares its per-question steps as an ordered list (`config.steps`, each with an `id` and a `kind`),
so any pipeline (HyDE, decomposition, several retrievers, verification loops) shows up as it is, in its
order. Only the library has a fixed shape: documents → chunks → vectors, stored once and shared.

## Layout

```
viz/
  db/
    compose.yaml          Postgres 17 + pgvector, PostgREST, dbmate
    init/00-roles.sh      login roles (passwords from .env), first start only
    migrations/           numbered SQL, applied by dbmate
    tests/                integrity.sql, contract.sql (both build their own data, then roll back)
    tools/                jwt.py (a write-role token for curl), load-providers.sh
  providers.json          providers, their models, key variable names, default model per step kind
  frontend/               React 19 + Vite; one folder per concern
    src/api/              PostgREST client, types, TanStack Query hooks
    src/components/       HUD pieces: Timeline, Dock, Inspector, Readout, RiseFall, ...
    src/pages/            one file (+ css) per page
    src/styles/           tokens.css (verbatim), extend.css, base.css, hud.css, page.css
  docs/
    DESIGN_LANGUAGE.md    the design rules, plus every extension made while building
    backend-contract.md   how a spike writes its results in
```
