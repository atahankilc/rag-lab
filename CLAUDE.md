# CLAUDE.md

## What this project is

A learning project. The owner has never built a RAG system by himself and is learning enterprise
RAG (`erag`) step by step, scored on EnterpriseRAG-Bench. The goal is understanding, not just a
working system: each stage should make clear *why* a technique helps or doesn't.

Topics to cover over time:
- **Embeddings:** different embedding models (OpenAI vs. local, e.g. bge) and how they change retrieval.
- **RAG strategies:** naive, hybrid (BM25 + dense), structure-aware chunking, reranking, query
  rewriting, conflict-aware answering, agentic RAG.
- **How knowledge is represented, and how that changes results:** vectors only, a knowledge graph
  (entities and relations), labels/metadata (source, project, author, date), and combinations of
  these. Compare them on the same questions.

## Current state

Started over from a clean slate on 2026-10-14: a pre-generated scaffold (infrastructure, stubs,
tests, docs) was removed because the owner didn't understand it. A copy is in
`../rag-scaffold-backup/`, for reference only. Don't restore it wholesale. What's left: the corpus
in `data/` (raw zip plus a dev subset), the benchmark repo in `vendor/EnterpriseRAG-Bench`, and a
uv environment (`pyproject.toml`, deps only, no package yet).

On 2026-10-14/15 the repo got two folders:
- `rag/`: the RAG implementation. Not started. Everything under "How to help" applies here.
- `viz/`: **RAG Lab**, a local Postgres + PostgREST + React app that stores every version of the
  RAG system and compares them. It's tooling, not the learning target, so Claude wrote it directly,
  page by page, with the owner reviewing each step. A spike in `rag/` reports results by following
  `viz/docs/backend-contract.md`. The UI follows `viz/docs/DESIGN_LANGUAGE.md`. There is no demo
  data: versions come only from real spikes. Providers live in `viz/providers.json`. A version's
  per-question pipeline is an ordered list of steps in its config (nothing hard-coded); only the
  library (documents -> chunks -> vectors) has a fixed shape.

## How to help

- Build everything up together, one small understandable piece at a time, starting from loading
  and reading the data. Nothing should exist in the repo that the owner hasn't seen built and
  understood.
- For the RAG components (chunking, embedding, retrieval, generation), explain concepts, give
  hints, review his code and debug with him. Don't write the solutions unless he asks for them.
- Plumbing (data loading, scoring, judge) can be written together more directly, but explain it
  as we go.
- Change one thing per experiment, and keep a lab notebook of each result and what it taught.
- Connect results back to the benchmark's question types (basic, semantic, constrained,
  conflicting_info, completeness, ...), so it's clear which failure each technique targets.
