# RAG Lab: run everything from the repo root.
#   make db       start Postgres + PostgREST
#   make migrate  apply the SQL migrations in viz/db/migrations (dbmate)
#   make providers  load viz/providers.json (add or update providers and default models)
#   make reset    drop the database volume and rebuild it from scratch (db + migrate + providers)
#   make dev      start the UI (viz/frontend)
#   make test-db  run the SQL integrity tests
#   make test-contract  run the backend contract, step by step, as lab_backend (rolled back)
#   make psql     open a psql shell on the lab database
#   make user NAME=...  add a UI user or set a new password (there is no sign-up in the UI)

COMPOSE := docker compose --env-file .env -f viz/db/compose.yaml
PSQL    := $(COMPOSE) exec -T db psql -v ON_ERROR_STOP=1 -q -U lab -d lab

.PHONY: db migrate providers reset dev test-db test-contract psql down token user

db:
	$(COMPOSE) up -d --wait db api

migrate:
	$(COMPOSE) run --rm dbmate --wait up
	@$(PSQL) -c "notify pgrst, 'reload schema'"

providers:
	@viz/db/tools/load-providers.sh | $(PSQL) -t

reset:
	$(COMPOSE) down -v
	$(MAKE) db migrate providers

dev:
	cd viz/frontend && pnpm install && pnpm dev

test-db:
	$(PSQL) < viz/db/tests/integrity.sql

# connects as lab_backend, exactly like a backend spike would
test-contract:
	$(COMPOSE) exec -T -e PGPASSWORD=$$(grep '^LAB_BACKEND_PASSWORD=' .env | cut -d= -f2) db \
		psql -h localhost -U lab_backend -d lab -v ON_ERROR_STOP=1 -q < viz/db/tests/contract.sql

psql:
	$(COMPOSE) exec db psql -U lab -d lab

down:
	$(COMPOSE) down

# A signed JWT for the write role, for trying the RPCs with curl.
token:
	@uv run --no-project python viz/db/tools/jwt.py

# A UI login. Asks for the password twice; it is stored as a bcrypt hash.
user:
	@viz/db/tools/add-user.sh "$(NAME)"
