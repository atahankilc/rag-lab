# Next steps for RAG Lab (handoff, 2026-10-15)

## State

- RAG Lab (`viz/`) is complete: database (8 migrations), all seven pages, backend contract, tests.
- No seed or demo data; providers in `viz/providers.json` (`make providers`); pipelines declared per version as
  an ordered `config.steps` list; only the library (documents → chunks → vectors) has a fixed shape.
- **The full Space page is built** (migration 8, `20261015000008_space.sql`), with all seven proposed parts:
  2D/3D with a projection switch, colour by any field, filters and search, questions on the map with a per-step
  switch, true neighbours via pgvector, comparing versions side by side,
  and a chunk inspector. At the owner's request it is **generic**: colours, filters and the inspector use whatever
  fields the corpus has (document columns, any `metadata` keys, chunk measures, clusters, retrieval outcome),
  with types detected from the values. How a field shows is edited on the page and saved per corpus name
  (`lab.field_style`, logged). 3D is a hand-written canvas renderer, not three.js.
- Follow-up the same day, at the owner's request: the distance rings are gone; 3D has real depth cues (the map
  lies on a floor grid with shadows, fog, drop lines, slow idle rotation); the morph control is gone because
  stepping the timeline between versions with the same chunks already glides the points; comparing two maps is
  a `Compare` select on the Space page (a separate Compare · Space page was dropped); the Space readout's
  controls are an aligned label/control form; inputs and selects are pills like the buttons. Navigation is
  floating text tabs centred at the top with the wordmark, a gliding blue underline as the only mark, and a
  section's subpages (Compare: Metrics · Config) on a quieter row centred under its tab. Pages keep their
  centred columns.
- New for spikes (all optional, see the contract): `chunk.metadata`, `projection.cluster`, `z`, more methods.
- Verified: `make test-db` (67 checks), `make test-contract`, `pnpm build`, and a browser check at 1440×900,
  1920×1080 and 390 wide, against a throwaway fixture outside the repo (mixed jira / github_pr / xlsx documents,
  two models on the same chunks, one other chunking). The fixture was wiped with `make reset` afterwards.
- **Nothing is committed.** The owner is renaming the repo folder to `rag-lab` and connecting it to git. The
  Python project is already named `rag-lab` (`pyproject.toml`, `uv.lock`).
- Open small item: model prices for `gpt-5-mini` and `gpt-5.4` in `providers.json` are `null` on purpose
  (unknown). The owner fills them in from OpenAI's pricing page.
- Known, not fixed: the build warns that the JS bundle is over 500 kB (one chunk, no code splitting), and
  `/favicon.ico` is a 404.

## Next: the first spike

The real work starts in `rag/`. Per `CLAUDE.md`, the owner writes it, and Claude explains, hints and reviews.
Start with loading the corpus and reading a few questions with their gold documents. When the spike writes
documents, put what describes each source (ticket type, repo, sheet, ...) in `document.metadata`: the Space page
picks it up without changes.
