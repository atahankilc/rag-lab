# rag-lab

Learning enterprise RAG step by step, scored on EnterpriseRAG-Bench.

| Folder | What it is |
|---|---|
| `rag/` | the RAG implementation, built one small piece at a time (not started yet) |
| `viz/` | **RAG Lab**: a local database + UI that keeps every version of the RAG system side by side, so each change can be compared ([viz/README.md](viz/README.md)) |
| `data/` | the corpus (raw zip + a dev subset), git-ignored |
| `vendor/EnterpriseRAG-Bench` | the benchmark: questions and the official evaluator |

## Quick start (RAG Lab)

Needs Docker, uv and pnpm.

```sh
cp .env.example .env    # fill in the LAB_* values
make reset              # database + API + providers (no demo data)
make dev                # UI on http://127.0.0.1:5173
```

A spike in `rag/` reports its results by following
[viz/docs/backend-contract.md](viz/docs/backend-contract.md).
