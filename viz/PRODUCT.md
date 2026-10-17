# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the repo owner, learning enterprise RAG step by step. They use RAG Lab on a laptop (~1440px) and a
large monitor (1920px+), at their desk, between runs. Phone use is not a priority; it only has to not break.

## Product Purpose

RAG Lab stores every version of a RAG system and its runs, and lets the owner see what each change did. Success is
understanding: after a run, the owner can tell which question types moved, why a given question was answered right or
wrong, and what each step cost.

## Positioning

It is the lab notebook of one learner's RAG experiments, scored on EnterpriseRAG-Bench. Versions form a lineage
(each one changes one thing from its parent), and every page compares a version with its parent or a pinned baseline.

## Operating Context

- A Python spike in `rag/` does the work and writes results into a local Postgres (`viz/docs/backend-contract.md`).
  The UI only reads, except for logged-in actions (queue a run, pin a baseline, provider switches).
- Typical loop: change one thing → run → open RAG Lab → read headline numbers → open individual questions → write the
  lesson in `rag/NOTEBOOK.md`.
- Opening a question must show, together: the answer next to the gold answer with the verdict and the judge's
  reasoning; the retrieved documents/chunks and whether gold evidence was found; the same question in another version;
  latency, tokens and cost per step.

## Capabilities and Constraints

- Pages: Pipeline, Space (2D/3D map of chunks), Questions, Compare (Metrics, Config), Runs, Providers, Log.
- Persistent chrome: navigation, a run dock, a version timeline, guide/utility controls.
- Data is real only (no demo data). Versions may lack chunks or vectors (closed-book v0).
- Stack: React 19, Vite, Tailwind v4, TanStack Query, PostgREST. Local only.
- Both a dark and a light theme exist and must both be kept (the light theme is not yet reviewed visually).

## Brand Commitments

- Name: RAG Lab.
- Look, set by the owner over several rounds: black and white, flat (no cards, no borders where avoidable),
  a living three.js dot pool behind every page, and a veil under every section that fades out past its edges
  so the dots never sit under text. Colour only where it means something: blue for what is live, green/red for
  better/worse, amber for warnings, a categorical palette for data. Motion is on by default.
- Space: the chunks rise out of the dot pool into the knowledge space; points stay crisp and clear in 3D.

## Evidence on Hand

- Real data: the erag-dev corpus (20,172 documents), 100 dev questions, version v0 with one judged run.
- No users, testimonials or external claims; none should be invented.

## Product Principles

1. Every screen answers "what changed, and why" before anything else.
2. One question, fully explained, in one view: no hunting across panels.
3. Real numbers only; an empty state says what is missing and how to get it.
4. The tool serves learning: labels explain RAG terms in plain words.
