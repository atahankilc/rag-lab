# Roadmap: RAG from the ground up

Every version below is one change from its parent. Results and lessons go in [NOTEBOOK.md](NOTEBOOK.md).
Started 2026-10-15.

## Ground rules

- **One change per version.** Each version names its parent and says what changed and what we expect.
- **Fixed judge:** `gpt-5.4` for the whole project. Changing it makes old and new scores incomparable.
- **Fixed answer model:** `gpt-5-mini`, until a version tests models on purpose.
- **Tune on dev, report on the rest.** The 100 dev questions (10 per type) are part of the 500. Tune on dev;
  at the end, report once on the other 400.
- **Predict before running.** Write down which question types should move, and which way. The notebook entry
  compares the prediction with what happened.
- **Two speeds of evaluation.** Retrieval metrics (recall@k, MRR) need no LLM and cost nothing: use them for
  most tuning. Answer metrics (correctness, completeness) cost judge money: run them when a version is worth it.
- **Who writes what.** Plumbing (phase 0, reporting): written together. RAG components (retrieval, chunking,
  embedding, prompts): the owner writes them, Claude explains, hints and reviews.

The benchmark's metrics: **correctness** (LLM judge vs. the gold answer), **completeness** (fraction of
`answer_facts` supported), **document recall** (gold docs among the submitted `document_ids`), **invalid extra
documents** (submitted docs that are neither gold nor judged valid).

---

## Phase 0: Plumbing

| # | Step | What it teaches |
|---|---|---|
| 0.1 | Read the data by hand: about 10 questions (one per type), their gold docs, one doc per source | What enterprise data looks like; why each question type is hard |
| 0.2 | `rag/data.py`: `load_questions()`, `load_documents()` (id, source, subfolder, title, text) | Corpus stats: docs per source, length distribution |
| 0.3 | Answer-file writer: `{question_id, answer, document_ids}` | The contract with the benchmark |
| 0.4 | Run the official evaluator on 3 hand-written answers (perfect, wrong, "I don't know") | What each metric really measures, and what a scored run costs |
| 0.5 | `rag/metrics.py`: recall@k, hit@k, MRR, per question type | Judging retrieval for free |
| 0.6 | LLM wrapper with a disk cache (model + prompt hash) and token/cost logging | Reruns are free; cost per version is visible |
| 0.7 | Lab notebook format | Turning runs into understanding |
| 0.8 | Reporter to RAG Lab (`viz/docs/backend-contract.md`) | Every version visible and comparable in the UI |

## Phase 1: Baselines, no retrieval

| Version | Change | Why |
|---|---|---|
| **v0** | Closed-book: `gpt-5-mini` answers with no documents, `document_ids: []` | The floor. The company is fictional, so expect ~0 except maybe `info_not_found` / `high_level`. Shows what the benchmark rewards |
| v0.1 | The prompt allows "I don't know" | Hallucination vs. abstention: `info_not_found` should rise, the rest stays ~0 |
| *oracle* | Gold docs straight into the prompt (diagnostic, not in the lineage) | The generation ceiling. Later, oracle vs. vN separates retrieval failures from generation failures |

## Phase 2: Sparse retrieval (first real RAG)

| Version | Change | Targets |
|---|---|---|
| **v1** | BM25 on whole documents, written from scratch (tokenize, TF, IDF, length norm); top 5 into the prompt | `basic`, codenames |
| v1.1 | top_k sweep 3 / 5 / 10 / 20 (free recall@k) | Recall vs. noise |
| v1.2 | Tokenisation: lowercase, stopwords, stemming | Preprocessing for lexical search |
| v1.3 | k1 / b | Length normalisation on short Slack vs. long docs |

Expected lesson: `semantic` questions do badly because they share few words with their gold docs.

## Phase 3: Embeddings and dense retrieval

| Version | Change | Targets |
|---|---|---|
| 3.0 | Exercise: embed 10 sentences, cosine similarity by hand in numpy | What a vector "means" |
| **v2** | Dense on whole docs, `text-embedding-3-small`, brute-force numpy search | `semantic` |
| v2.1 | Local `bge-base-en-v1.5` (only the model changes) | Cloud vs. local: quality, speed, cost |
| v2.2 | `text-embedding-3-large` | Are more dimensions worth it? |
| 3.x | Space page: do sources/projects cluster? Where do gold docs sit relative to questions? | Intuition for embedding spaces |

Expected lesson: one vector per long document blurs its details. That motivates chunking.

## Phase 4: Chunking

| Version | Change | Targets |
|---|---|---|
| **v3** | Fixed-size token chunks (e.g. 512, no overlap); retrieve chunks, map back to doc ids | `intra_document_reasoning` |
| v3.1 | Size sweep 256 / 512 / 1024 | Precision vs. context |
| v3.2 | Overlap | Facts split across boundaries |
| v3.3 | Chunks to doc ids: dedupe, max vs. sum aggregation | Doc recall and invalid extras |
| **v4** | Structure-aware chunking per source (Slack threads, email messages, Jira fields, Confluence headings, Fireflies speaker turns) | `miscellaneous`, `intra_document_reasoning` |
| v4.1 | Contextual headers: title/source/channel prepended before embedding | Chunks meaningless without context |

## Phase 5: Hybrid retrieval

| Version | Change | Targets |
|---|---|---|
| **v5** | BM25 + dense, fused with RRF | `basic` and `semantic` together |
| v5.1 | RRF `k`, weights, candidate depth | Fusion tuning |

## Phase 6: Reranking

| Version | Change | Targets |
|---|---|---|
| **v6** | Hybrid top 50, `bge-reranker-v2-m3` cross-encoder, top 5 | `constrained` |
| v6.1 | LLM reranker vs. cross-encoder | Quality vs. latency and cost |

Concept: bi-encoder vs. cross-encoder; why reranking is a second stage.

## Phase 7: Query side

| Version | Change | Targets |
|---|---|---|
| **v7** | LLM query rewriting | `semantic`, vague wording |
| v7.1 | HyDE (embed a hypothetical answer) | `semantic` |
| v7.2 | Multi-query / decomposition, merged results | `completeness`, `project_related` |

## Phase 8: Generation side

| Version | Change | Targets |
|---|---|---|
| **v8** | Citations; `document_ids` = cited docs only, not all retrieved | Invalid extra docs (recall vs. precision) |
| v8.1 | Conflict-aware answering: date + source per passage, surface contradictions, prefer newest | `conflicting_info` |
| v8.2 | Calibrated abstention (retrieval scores + prompt) | `info_not_found` without losing answerable questions |
| v8.3 | Context budget: dynamic k, ordering (lost in the middle) | General |

## Phase 9: How knowledge is represented

| Version | Change | Targets |
|---|---|---|
| **v9** | Metadata/labels (source, project, author, date) in `document.metadata`; a query-driven `filter` step | `constrained`, `extra_questions.jsonl` |
| v9.1 | LLM-extracted labels (project codename tags) | `project_related` |
| **v10** | Knowledge graph: LLM entity/relation extraction; retrieval expands hit chunks to graph neighbours | `project_related`, `completeness` |
| v10.1 | Community summaries (GraphRAG-style) | `high_level` |
| v10.2 | Matrix on the same questions: vectors / + metadata / + graph / all three | The central representation lesson |

## Phase 10: Agentic RAG

| Version | Change | Targets |
|---|---|---|
| **v11** | Router: pick a strategy or source per question | Mixed workloads |
| v11.1 | Agent loop with `search` + `read_doc` tools until it has enough | `completeness`, `high_level`, `project_related` |
| v11.2 | Compare with the benchmark's `agent_retrieval` | A reference point |

## Phase 11: Scale and final report

1. From the 20k-doc dev corpus to the full ~500k: brute force becomes an ANN index (pgvector HNSW). Measure build
   cost and recall loss.
2. Run the best 3–4 versions once on the held-out 400 questions.
3. Final notebook entry: which technique fixed which question type, at what cost.

## Notes

- RAG Lab accepts versions without a chunk set or embedding space (migration
  `20261015000010_optional_library.sql`), so v0 (no retrieval) and v1 (BM25, no vectors) can be reported.
