# Design language: "Instrument on black"

A **dark-only, instrument-panel** style: a true-black
field, white contacts, one blue for "the thing you are pointing at," and numerals that carry the information. It
reads like a radar or tracking console, not a SaaS dashboard.

> The core idea: **numerals carry the information; words are labels, never paragraphs.**
> No cards, no boxes, no shadows. Hairlines and type do the structuring.

The tokens live in `frontend/src/styles/tokens.css` (verbatim from section 2). Additions are in
`frontend/src/styles/extend.css` and listed under [Extensions](#extensions) at the end.

---

## 1. Principles

1. **True black ground.** `#000`, not dark grey. Everything else floats on it. Only one theme: dark. No light mode.
2. **Frameless.** No cards, borders around panels or drop shadows. Panels are a translucent black *field* whose edges
   **feather** (mask-image gradient) into the background. Sections are split by 1px hairlines.
3. **Numerals lead.** Every screen opens with a row of big, light, wide, tabular numbers with small labels above
   them and small deltas beside them. Prose is short and secondary.
4. **Colour is semantic and rare.** Grey ink does almost everything. Blue = selection / active / "the sweep."
   Amber = attention (weakened, warning, cap reached). Green/red = *only* "improved / regressed" vs a reference.
   Categorical hues = only for data types inside visualisations. Never decorative.
5. **Corners hold the instruments.** Fixed HUD layout: readout top-left, navigation top-centre, utility pills
   top-right, dock bottom-left, timeline bottom-right, the main visual in the centre filling the screen.
6. **Pills, not buttons.** Every control is a 26–32px rounded-full pill with a hairline border on a 60% black fill.
7. **One timeline.** State evolves over checkpoints; a scrubber in the bottom-right corner moves the whole app
   through time. Deltas (`+466`) are always relative to the previous checkpoint.
8. **Traceable.** Every number can be opened in an inspector that shows where it came from. An append-only log
   (audit trail) records what changed and who/what changed it.
9. **Calm motion.** Short ease-out transitions (160/240ms), small 3–6px slide-ins, one slow "sweep" (2.4s) when the
   timeline moves. Respect `prefers-reduced-motion`.

---

## 2. Tokens (copy verbatim)

```css
:root {
  color-scheme: dark;

  /* ground */
  --void: #000000;                       /* page background */
  --glass: rgba(10, 12, 15, 0.72);
  --hair: rgba(255, 255, 255, 0.09);     /* default hairline / border */
  --hair-2: rgba(255, 255, 255, 0.16);   /* hover / active border, rails */
  --field: rgba(0, 0, 0, 0.86);          /* frameless panel fill (+ blur 10px) */

  /* ink */
  --ink: #f2f4f7;     /* primary text, numerals */
  --ink-2: #b4bac4;   /* secondary text, chip text */
  --ink-3: #868d99;   /* labels, captions (≥ 4.5:1 on black) */

  /* signal */
  --sweep: #1c69d4;                      /* the one accent */
  --sweep-hi: #4d94ff;                   /* links, focus ring, active dot */
  --sweep-wash: rgba(28, 105, 212, 0.18);/* halo around the active dot */
  --lost: #f5a524;                       /* amber: attention / weakened / warning */

  /* comparison vs reference (ONLY for better/worse, never data hues) */
  --rise: #2fbf71;  --rise-hi: #5ee69a;  --rise-glow: rgba(47, 191, 113, 0.26);
  --fall: #ff3b30;  --fall-hi: #ff6961;  --fall-glow: rgba(255, 59, 48, 0.34);

  /* type */
  --font: "Mona Sans Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --t-micro: 11px;   /* captions, meta, column heads */
  --t-label: 12px;   /* labels, chips, list rows */
  --t-body: 14px;    /* body */
  --t-read: 18px;    /* inspector titles */

  /* space, shape, motion */
  --edge: 24px;                          /* distance of every HUD element from the viewport edge */
  --r: 10px;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --fast: 160ms;
  --med: 240ms;
  --sweep-ms: 2400ms;                    /* timeline transition */
}
```

**Categorical data palette** (validated on black, for data types inside charts/3D only):
`#3987e5` blue · `#d95926` orange · `#199e70` green · `#c98500` gold · `#d55181` pink.
Extra hues for more categories: `#2bb5c6` cyan · `#9b6ce0` violet · `#e0a33b` amber-gold.

**3D scene** (three.js) uses: bg `#08090b`, panel `#0e1014`, hairline `#1d2027`, text `#e8ebf0`, muted `#8a93a3`.

---

## 3. Typography

- **Font:** Mona Sans Variable (`@fontsource-variable/mona-sans/wdth.css` — the *width* axis version).
- Base: 14px, line-height 1.45, `-webkit-font-smoothing: antialiased`, **`font-variant-numeric: tabular-nums` globally.**
- **The instrument numeral** (`.num`): `font-stretch: 118%; font-weight: 300; letter-spacing: -0.02em; line-height: 1;`
  - Readout size 28px; inspector figure 34px; timeline counts 20px.
- **Page title** (full-screen pages): 28px, weight 300, `font-variation-settings: "wdth" 118`, letter-spacing -0.02em.
- **Section heading:** 12px, weight 600, UPPERCASE, letter-spacing 0.08em, `--ink-3`. Optional number after it in `--ink-2` (e.g. `RETRIEVAL  $0.42`).
- **Labels:** 11px `--ink-3`, letter-spacing 0.02em, sentence case, above numerals.
- **Time/axis labels:** 11–12px, weight 600, letter-spacing 0.08–0.1em, uppercase (`V3`, `OCT 14`).
- **Deltas:** 12px weight 600 `--ink-2`, e.g. `+466` next to the numeral, baseline-aligned.
- **Lede:** 13px, line-height 1.5, `--ink-3`, max-width 80ch.
- Weights used: 300 (numerals, titles), 400, 500 (names in lists), 600 (labels, active tabs), 650 (wordmark).

---

## 4. Layout: the HUD

```
┌────────────────────────────────────────────────────────────────────────────┐
│ READOUT (numerals)        [logo] (Tab)(Tab)(Tab)(Tab)    (Util)(Util)(Log) │  top: --edge
│ 15,043 → 400 → 107 → 40                                                    │
│ ‹ 3/4 › Stage name  one-line description                                   │
│ (filter)(filter)(filter)(filter)…                                          │
│                                                                            │
│                         MAIN VISUAL (full-bleed)                           │
│                     canvas / 3D scene / chart field                         │
│                                                     ┌ inspector sheet ┐   │  right, under top bar
│                                                     │ frameless field │   │
│ ┌ dock panel ┐                                      └─────────────────┘   │
│ │ guide/log  │          Spread ●──────── 1.0×  ↓ ↑ ⊕                      │
│ └────────────┘          hint text: keys…                    Checkpoint     │
│ (Guide)(Run)                                                v0 v1 v2 ●    │  bottom: --edge
└────────────────────────────────────────────────────────────────────────────┘
```

- Everything is `position: fixed` at `var(--edge)` from the edges. The visual sits behind (`inset: 0`).
- **Top-left readout / funnel:** numerals connected by `→` arrows showing a pipeline (stage A → B → C), each with a
  label above and small deltas/sub-counts beside or below. Below: a stage stepper `‹ 3/4 ›  **Stage** description`.
- **Top-centre:** logo mark + wordmark (text only, never a pill), then pill tabs for the main pages.
- **Top-right:** utility pills with lucide icons (e.g. Providers, Log).
- **Bottom-left dock (300px wide):** row of pills (Guide, Agent…); the open one's panel expands *above* the pills on
  the feathered field. One panel open at a time. Agent panel = live progress: "2 / 4 stages done," segmented
  progress bars with stage names, then a log list with relative times on the right (`38h`), older rows fading.
- **Bottom-right (300px):** checkpoint timeline. Title + one-line description, a 1px rail with labelled nodes
  (`v0 · v1 · v2`), ticks below, active node = blue dot with 4px wash halo, built nodes = filled ink,
  future = hollow. Under it: counts with marks (`● 412 kept  ○ 38 new`) and `← →` key hint.
- **Bottom-centre:** view controls (slider + icon buttons) and a single line of keyboard hints in 11px `--ink-3`.
- **Right inspector sheet:** 440px, opens on click, top at `--edge + 46px`.
- **Full-screen 2D pages** (tables, logs, settings): the visual is hidden, content in a centred column
  `max-width 1320px`, sticky header with title + lede + filter chips, sections separated by hairlines.
- Mobile ≤760px: tabs move to the bottom, dock goes full width; ≤900px tables collapse to name + toggle.

---

## 5. Components

**Pill tab / pill button** (navigation now uses floating text tabs, see Extensions › Navigation)
`height 32px; padding 0 15px; border-radius 99px; border 1px solid var(--hair); background rgba(0,0,0,.6);
font 13px/600, letter-spacing .04em; color var(--ink-3)`. Hover: `--ink`, border `--hair-2`. Active:
`--ink`, border `--hair-2`, bg `rgba(255,255,255,.07)`. Icon (lucide, 14px) + text, gap 6px.

**Filter chip** — 28px pill, 12px `--ink-2`, tiny coloured glyph before the label. When a value is set: border
`rgba(77,148,255,.55)` (blue), shows `Label  value  ×`. Clicking opens a **popover list** on the feathered field:
rows of `name | 2px bar | count`, selected row's bar in `--sweep-hi`. A fold toggle (`⇉ «`) at the head of the row
hides unused chips. Chips animate in with 3px slide + fade.

**Segmented control** — hairline pill container with 2px padding; inner 24px pills; active = `rgba(255,255,255,.09)`
fill + `--ink`. Can have a leading 11px label inside (`Provider  Local Cloud`).

**Small chip / count chip** — 26px, `Label  count` with count in `--ink-3`; pressed state = blue border.

**Feathered field (the only "panel")**
```css
background: var(--field);
backdrop-filter: blur(10px);
--feather: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 14px), transparent),
           linear-gradient(to bottom, transparent, #000 12px, #000 calc(100% - 12px), transparent);
mask-image: var(--feather); mask-composite: intersect;   /* + -webkit- variants, source-in */
```
Used for: inspector, hover card, popovers, dock panel. Never a border, radius or shadow.

**Inspector sheet** — head: layer name (12px/600 with a coloured mark) + what-it-is line (12px `--ink-3`) + title
(18px/500, `text-wrap: balance`); big figure (`.num` 34px + delta); then sections of hairline-railed items
(`border-left: 1px solid var(--hair-2); padding-left: 12px`). Close = 30px ghost icon button top-right.

**Hover card** — 320px, follows the pointer, feathered field, 13px text clamped to 3 lines + 11px meta row.

**Inputs and selects** (RAG Lab extension) are pills like the buttons beside them: 30px, `border-radius 99px`,
14px side padding, hairline border, `--field` fill. Selects draw their own 12px `--ink-3` chevron 12px from the
right edge. Multi-line text areas keep the softness at a fixed 14px radius.

**Tables (full-screen pages)** — CSS grid rows, `padding 9px 0`, row divider `rgba(255,255,255,.05)`, head row 11px
`--ink-3` with `--hair` divider. Name cell = 13px/500 `--ink` + 11px `--ink-3` description under it. Numbers
right-aligned, tabular, value 13px/500 + 11px meta under (`41 calls · 10 Oct`). Selects and inputs are 28–32px pills
(see Inputs and selects). Disabled rows dim to 0.42 opacity.

**Toggle switch** — 28×16, track `--hair-2`, knob `--ink-3`; on = track `--ink-2`, knob black. No colour.

**Thin bars** — 2–3px tall, track `--hair`, fill `--ink-2`; fill turns amber (`--lost`) when a limit is reached,
blue when selected. Used for proportions, caps, distributions — instead of chart widgets.

**Status marks (8–9px)** — `●` filled ink = held / existing; `○` ring = new; double ring = strengthened; amber dot
= weakened; amber × = lost. Used in legends, counts, lists. Keep this vocabulary.

**Rise / fall callouts** — only for "better / worse than the reference." Row with a 2px left bar in
`--rise`/`--fall`, faint matching background (`*-glow` at low alpha), heading like `▲ 3 improved` /
`▼ 1 regressed — review` in the hi colour, then the item and its cause in 11px.

**Log / audit trail** — vertical 1px rail with hollow/filled circle nodes, grouped by day header (`SUN 11 OCT`, 11px
uppercase spaced). Row: action text 13px `--ink` (bold for system milestones), meta line 11px
`--ink-3` `Actor · model · 11:57`. Filter row on top: segmented checkpoint picker + count chips by stage + by actor.

**Loading** — 64px hairline circle with a blue arc spinning (1.4s linear). Labels in 12px spaced `--ink-3`.
Errors: amber text, centred, max 48ch.

**Focus** — `:focus-visible { outline: 1px solid var(--sweep-hi); outline-offset: 3px; border-radius: 4px; }`.
Selection: `rgba(77,148,255,.4)`.

**Scrollbars** — `scrollbar-width: thin; scrollbar-color: var(--hair-2) transparent`.

**Icons** — lucide-react, 14px, stroke 1.5–1.75, colour inherits. Logo: a single-stroke line mark, 27px high.

---

## 6. Visualisation style

- The central visual is a **field of points/marks on black** (radar / scan volume). Points are small, coloured by
  data type with the categorical palette; selection lights in blue; dimmed items go to 0.1 opacity.
- Labels drawn in the scene: 11–12px, `rgba(0,0,0,.6–.7)` backing with 4px radius, never boxed further.
- Concentric rings / axes are 1px `--hair` lines; time is an angular or linear axis with uppercase spaced labels.
- Charts are built from hairlines, thin bars, dots and numerals — not from a chart library's default look.
  No gridline clutter, no legends in boxes; legends are inline mark + label rows (see the Guide panel).
- Camera/view controls: a `Spread` slider, zoom/reset icon buttons, keyboard hint line.

---

## 7. Voice & copy

- Short, concrete, sentence case. Labels name a thing; descriptions say what it is in one line.
- Numbers first, then the word: `30 questions · 4 regressed · 2 failed`.
- Separators: ` · ` for metadata, `→` for pipeline flow.
- Guide panels explain each colour/mark in a one-line sentence: **Bold name** + plain explanation.
- No exclamation marks, no emoji, no marketing tone.

---

## 8. Do / Don't

| Do | Don't |
|---|---|
| True black, hairlines, feathered fields | Grey cards, drop shadows, gradients as decoration |
| One blue accent for active/selected | Multiple accent colours, coloured buttons |
| Green/red only for better/worse vs reference | Green = "success" toasts, red = generic "danger" buttons |
| Big light wide numerals with deltas | Bold heavy KPI tiles with icons in circles |
| Pills with hairline borders | Filled primary buttons |
| Fixed corner HUD around a full-bleed visual | Sidebar + header + content grid template |
| Tabular numbers everywhere | Proportional numbers that jiggle when values change |

---

## Extensions

Things RAG Lab needed that the language above doesn't cover, extended in the same spirit.

### Tokens (`extend.css`)

- `--cat-1` … `--cat-8`: the categorical palette above as variables, in the listed order.
- `--corner-w: 300px` (dock and timeline), `--inspector-w: 440px` (380px under 1100px wide),
  `--nav-top: 10px` (the menu, utilities and readout), `--top-bar-h: 46px`, `--row-divider: rgba(255,255,255,.05)`.
- `--edge` drops to 16px at ≤760px.

### Deltas vs a reference

- Principle 7 says deltas are vs the previous checkpoint. RAG Lab compares against either the **parent**
  version or the **pinned baseline**, picked with a `vs  Parent | Baseline` segmented control in the timeline.
- A delta is green/red only when the metric has a direction (`metric_def.higher_is_better`). Counts that are
  neither better nor worse (chunks, retrieved items) keep the neutral `--ink-2` delta.
- A zero change is written `±0.00`, in neutral ink.

### Pipeline stage marks (on the stage rail)

| Mark | Meaning |
|---|---|
| filled ink dot | stage present and unchanged vs the reference |
| filled blue dot | stage config changed vs the reference |
| hollow blue ring + `NEW` micro-pill | stage the reference doesn't have |
| dashed ink ring, card at 0.42 opacity, `—` | stage this version doesn't have |
| blue wash halo | the selected stage (stepper / inspector) |

Blue means changed or selected here, which is still "the thing you are pointing at": what's new in this version.

### Config chips (`.kv-chip`)

22px hairline pill, 11px: key in `--ink-3`, value in `--ink-2`. A value that differs from the reference gets
the filter-chip blue border. Unknown config keys still render as chips, labelled with their path.

### Local / cloud badge (`.loc`)

18px pill, 10px uppercase 600, `--hair-2` border. **Cloud has a dashed border**, local a solid one, so the two
differ without colour.

### Timeline additions

- Version nodes without a finished run are hollow (the "future" state).
- The pinned baseline gets a 9px uppercase `BASE` label under its tick.
- The counts line uses rise/fall/held marks: `● 7 better  ● 2 worse  ● 21 same  vs v1`.
- The hover card shows the version note (3 lines) and its config diff vs its parent, `path  old → new`, with the
  new value in `--sweep-hi`.

### Dock Run pill

While a run is queued or running, the Run pill shows a 10px hairline ring with a spinning blue arc (the loading
mark, scaled down).

### Phone (≤760px)

- Top row: dock pills on the left (their panel drops down full width), utility pills icon-only on the right.
- The page scrolls normally between the top row and the bottom chrome.
- Bottom: tabs in a black bar, and above it a compact timeline (rail + reference switch, no counts).
- The inspector becomes a bottom sheet. Here the timeline and inspector use solid `--void` with a hairline top
  border instead of the feathered field, because feathering over scrolling text made it hard to read.

### Questions page

- **Verdict column:** `▲` in `--rise-hi` = better than the reference by ≥ 0.1 on the primary metric, `▼` in
  `--fall-hi` = worse, a 6px grey dot = changed by less than that, `—` = no reference.
- **Score cells:** value 13px/500 with the change vs the reference as the 11px meta line under it, coloured only
  when it is a real improvement or regression (|Δ| ≥ 0.005).
- **Relevance marks in retrieved context:** filled dot = the chunk overlaps gold evidence, ring = not relevant.
  **Gold evidence the final context missed** gets the amber × ("lost"), the same mark the Space view uses for
  relevant chunks that weren't retrieved.
- **Citations:** `[1]` markers in the answer are 11px/600 `--sweep-hi` links. Clicking one selects the final stage,
  scrolls to the cited chunk and gives it a brief `--sweep-wash` background.
- **Selected row:** faint blue background and a 2px `--sweep-hi` bar on the left. ↑ ↓ move between rows.
- **Wide inspector:** 520px (`.inspector.wide`) when it holds a side-by-side comparison. The 440px default stays
  everywhere else.

### Compare pages

Two subpages: **Metrics** (`/compare`) and **Config** (`/compare/config`). Both open with the same
`slug name vs [select]` picker. Comparing two maps happens on the Space page.

- The left side is always the timeline's version. The right side is picked with a native `<select>` styled as a
  32px hairline input (`.select`). Each option shows `slug · name`, and `· baseline` / `· parent` where it applies.
- The metrics show as one table with three numbers per row (other, this, change) grouped under uppercase axis
  labels. The change is green/red by `higher_is_better`, so lower latency and cost count as better.
- The config diff lists only the paths that differ: old value in `--ink-2`, new value in `--sweep-hi`,
  `—` where a version doesn't have the setting.
- The spec's trend bars and the local-vs-cloud dot plot were left out at the owner's request.

### Space page

The full data-exploration view. It is generic: nothing on it knows what the corpus is (tickets, pull
requests, spreadsheets, ...). Everything it colours, filters and shows is a **field** found in the data.

- **Fields** come from the document columns (title, source, project, author, date, id), every key in
  `document.metadata` and `chunk.metadata` (nested keys become dotted paths), chunk measures (tokens,
  characters, position), the spike's cluster ids, and how the latest run retrieved each chunk (outcome,
  retrieved by n questions, relevant to n questions). A field nobody filled in doesn't appear.
- **Field types are detected from the values:** all numbers (or numeric strings) = number, all ISO dates = date,
  at most 30 distinct strings = category, otherwise text. Text is searchable but never coloured. A field with
  one value everywhere is not offered for colour or filters.
- **Fields sheet** (the `Fields n` chip opens it in the inspector): one row per field, grouped, with a blue
  dot when adjusted and a `COLOUR` micro-pill on the field in use. A row opens to rename it, override its type
  (`Category | Number | Date | Text`, the detected one named), hide it, pick a colour per value, or reset it.
  Settings are saved per corpus name (so a rebuilt corpus keeps them) and every change is logged.
- **Colour choices are limited to the palette:** the eight categorical hues plus `--ink` and `--ink-3`, shown as
  14px swatches. A free colour picker would let values drift off the palette validated for black.
- **Categorical colours follow the value, not its rank on screen:** value number *n* (by count over all chunks)
  gets the palette's *n*-th colour; choosing a colour for one value never repaints the others. Values past the
  eighth share `--ink-3` ("other"); chunks without a value are `#3a3f47` (dashed ring in the legend). The
  palette's blue still comes last, because blue means "retrieved" here.
- **Numbers and dates use one sequential ramp, violet**, dark to light on black:
  `#4a3b80 #6450ad #8169d4 #a28be8 #c9b8f7` (2.2:1 to 11.7:1 against black). Violet, because blue is the
  selection colour and amber is attention. The legend is a 140×3px ramp with min and max.
- **Retrieval outcome** has its own defaults: found = cyan, partly found = pink, never found = `--lost` amber (the
  same amber as a missed relevant chunk), noise = violet, unused = `--ink-3`.
- **Legend:** inline `mark value count` rows; clicking a value keeps only that value (the chip gets the blue
  filter border), clicking again undoes it.
- **Filters** hide points; the **search** keeps them and dims the non-matches to 0.14. Active filters are
  standard filter chips (`Label value ×`) whose popover lists `value | 2px bar | count` (selected bar blue) or
  `From / To` inputs for numbers and dates. `+ Filter` opens a popover of the fields, grouped.
- **View controls** sit bottom-centre: `2D | 3D`, the projection methods the space has (`UMAP | PCA | ...`),
  zoom in / out / reset icon buttons, and a key-hint line. 3D is disabled (with a hint) when the spike wrote no z.
- **2D and 3D are one canvas renderer**, no 3D library. **The map lies on the floor** (its two main
  coordinates) and the third coordinate is height: 2D looks straight down, 3D tilts the floor back and turns it
  around the vertical axis. Going from 2D to 3D tilts the map and the points rise to their height.
  Drag pans in 2D and orbits in 3D (shift-drag pans; the tilt stops at the side view, never under the floor);
  the wheel zooms around the pointer.
- **Depth cues in 3D**, because a dot has no shading: far points fade towards the black (to 30%) and shrink, near
  ones grow; points are drawn far to near; a floor grid (`--hair`, outer edge `--hair-2`) sits under the cloud and
  every point casts a 2×1px shadow on it (ink at 9%); hits, the selected and the hovered chunk and the query get
  a dashed `--ink-3` drop line to the floor. After 2.5s without pointer movement the view turns slowly
  (0.12 rad/s); it stops while the pointer rests on a point. Not with reduced motion.
- **No distance rings.** They carried no data; the earlier "radar" rings were removed at the owner's request.
- **Motion:** whenever positions change (method, 2D/3D, or **the timeline moves to a version with the same
  chunks**), points move to their new place over the 2.4s sweep, keyed by chunk id; new points fade in. That is
  the timeline's sweep from principle 9, so there is no separate morph control. Camera moves ease. With reduced
  motion, everything jumps.
- **Fit box:** the field fits between the top-left readout and the right edge; when the inspector opens, the box
  slides left of it, so nothing hides under the sheet.
- **Questions on the map:** `◇ All` draws every question as a 3.5px hollow `--ink-3` diamond (hover names it,
  click picks it). The picked question is the white diamond; a segmented control picks which step's ranked list
  lights up (count = relevant chunks in that list), the final one by default. Marks as before: blue dots with
  ranks and lines to the query, an ink ring when relevant, amber rings for relevant chunks that list misses.
- **The selected chunk:** a `--sweep-wash` disc with a 1.5px ink ring, thin `--ink-2` lines to its true nearest
  neighbours (by cosine over the real vectors) and 5px rings around them.
- **Chunk inspector:** tokens / retrieved by / relevant to as numerals; the full text; for the picked question,
  its rank and score in every step; **true neighbours** with similarity and `map #n`, its rank among the nearest
  points on screen, amber when it is beyond 10 (the projection distorted that distance), headed
  `n of 10 also near on the map`; the questions it served (filled dot = relevant, ring = not); relevant questions
  that never retrieved it (amber ×); then every field value.
- **The readout's controls are a small form:** under the numerals, a `--hair` rule, then a 64px label column
  (`Compare`, `Question`, `Colour`, `Filter`; 11px `--ink-3`) and one control column. Selects fill the column;
  a related chip sits at the end of its row (`◇ All`, `Fields n`). Details sit under their control in the same
  column: the question's step switch and summary, and the colour legend. Many options still read as one
  aligned block.
- **Field placement:** with one version on a wide page the field sits beside the readout column; with two
  versions, or a page narrower than 1180px, it sits below the readout and uses the full width.
- **Comparing on the Space page:** the `Compare` select (`Only v3`, or `v3 vs v2 · model · chunking`, with
  `· same chunks` where it applies) splits the field into two panes (stacked when taller than wide) with a shared
  camera, each labelled `slug · model · chunking` in uppercase 11px. The chunk under the pointer, or the selected
  one, gets an ink ring in the other pane (its document's chunks when the chunking differs). Colours use one
  scale across both sides. (A separate Compare · Space page was tried and dropped: the map belongs here.)
- The view lives in the URL (`cmp`, `m`, `d`, `color`, `q`, `stage`, `all`, `chunk`, `fields`); filters and
  search don't.

### Navigation: text tabs with a gliding underline (replaces pill tabs)

Chosen by the owner after trying pills, capsules, a full-width bar and a side navigation: navigation is text,
not boxes, and it floats; there is no bar and no hairline across the page.

- **Top centre:** the wordmark and the page tabs together, centred on the page, `--nav-top` (10px) from the top
  edge. Tabs are 13px/600, letter-spacing .04em, 26px apart, `--ink-3`; hover and the open section are `--ink`.
- **The only mark is one 1px `--sweep-hi` underline** with a soft blue glow (`0 0 8px rgba(77,148,255,.6)`)
  under the open section. It glides to the next tab when you switch (240ms, `--ease`), and fades out on pages
  outside the tabs (Providers, Log).
- **Subpages** sit on their own quieter row, **centred under their section's tab**, 6px below: 12px/500
  `--ink-3`, separated by `·` in `--hair-2`; the open one is `--ink` with a short 12px `--ink-2` rule under it
  (not blue, so the main underline stays the one blue mark). Centring uses the `translate` property, because the
  row's slide-in animation sets `transform`. Today only **Compare** has subpages: `Metrics · Config`.
  Full-screen pages leave room for the row (`.hud.has-subs`).
- **Utilities** (Providers · Log, top right, also at `--nav-top`) and the **dock toggles** (Guide · Run, bottom
  left) are icon + text links in the same type, 18px apart; the open one is `--ink` with the same blue underline.
- The top-left readout starts at `--nav-top` too, so its label lines up with the tabs.
- Subpages share their state through the URL: the Compare pages keep `?with=` when moving between them.
- **Phones:** the tabs sit in the bottom bar (12px, 18px apart, no wordmark); the subpage row becomes a
  full-width bar under the top row, on `--void` with a hairline; utilities are icon-only.

### Runs page

- **Run status marks:** queued = ring (`○`), running = the loading mark at 10px (hairline circle, spinning blue arc),
  done = filled ink dot, failed = amber × with the status word in `--lost`. Red is never used for failure,
  because red only means "worse than the reference".
- **Stage bars** (3px): grey = done, blue = in progress, amber = failed at that stage.
- **Event log** in the inspector: `HH:MM:SS` in `--ink-3`, the stage as a 10px uppercase tag, then the message.
  Warnings and errors are amber; errors also get weight 600.
- **Queue form** (in the inspector sheet): one row per setting of the version's pipeline config
  (`path | 28px input | reset`). A changed setting gets the blue dot, a blue input border and a `was …` line; an
  unparseable value gets an amber border. New settings can be added by path; they get a blue `NEW` micro-label.
  The exact overrides JSON is shown before sending.
- The open run is kept in the URL (`?run=27`), so a link reopens it.

### Which HUD pieces appear where

The corners are instruments, so each one shows up only on pages where it means something.

| Page | Timeline (bottom right) | Dock: Guide | Dock: Run |
|---|---|---|---|
| Pipeline, Space, Questions, Compare | yes: these pages are about one version | yes | yes |
| Runs | no: it lists every version's runs | yes | no: the page itself is the full run view |
| Providers, Log | no: they span all versions | yes | yes |

Without the timeline, a full-screen page reserves less space at the bottom, and the inspector runs down to
`--edge`. Guide panels on these pages leave out the timeline marks.

### Providers page

- **Provider status** comes from the database only (on/off, spend vs cap). RAG Lab never calls endpoints, and the
  inspector says so. Marks: filled dot = ready, faded dot = ready but unused, amber dot = cap reached (the
  "weakened" mark), ring = off. An off row fades to 0.42, except its switch.
- **Spend:** `$spent` with `of $cap` / `no cap` as meta, and a 3px bar that turns amber once spend reaches the cap.
- **Price:** the lowest to highest model price per 1M tokens, or `free`.
- **The inspector** has the on/off switch, a cap editor (dollar input, `Save cap` pill, `No cap ×` chip),
  models with roles, dimensions and prices, the roles it is the default for, the versions that use it (per config
  key, with spend), and a note that keys live in `.env`.
- **Default model per role** is a read-only table under the providers, with an amber `provider is off` note when
  the role's provider is disabled.
- The open provider is kept in the URL (`?provider=openai`).

### Log page

- **Sentences, not codes:** every event reads as one plain sentence ("Created v3 Cross-encoder rerank, from v2",
  "Run #50 of v2 failed"). Milestones are 600 weight: a new version, a new baseline, a corpus, and a finished or
  failed run. Unknown actions fall back to `action · target · version`.
- **Rail marks** (9px on the 1px `--hair-2` rail): ring = something new (create, add, queue), filled ink =
  something existing changed, amber dot = warning (judge flag), amber × = failure (failed run, also in amber text),
  blue with wash = the open event.
- **Filters:** a segmented version picker (`All · v0 … · No version`; a dropdown on phones or with more than 10),
  a search box (server side, over action, note, id and version), then count chips by type and by actor. Each
  chip's count respects the other active filters.
- **Paging:** 100 events per page, newest first, with a `Load older events` pill. The list ends with a spaced
  `START OF THE LOG` label.
- **The inspector** shows the note, `What changed` (before → after for updates; recorded values for creates),
  the target with links to that version in Pipeline, the run or the provider, who the actor is, and the raw JSON.
- Inspector key/value rows keep the key at least 90px wide, so long values wrap instead of crushing the key.

### Pipelines are declared, not hard-coded

These rules replace the Pipeline page's earlier fixed stage list, and the parts of the Runs and Questions
notes above that name fixed stages.

- **Two groups on the Pipeline page:** `LIBRARY · BUILT ONCE` (ingest, chunk, embed: the fixed shape, shared
  between versions), a 1px `--hair` divider, then `PER QUESTION · n STEPS, IN ORDER`, the version's own steps in
  its declared order. A card shows the step's id (uppercase section heading), its kind's label under it when they
  differ, settings as chips, and its latency and cost.
- **Step marks vs the reference:** filled ink = same; blue dot = settings changed (the changed chips get the blue
  border); blue dot + `MOVED` micro-pill = same step, different place in the order; hollow blue ring + `NEW` = not
  in the reference; dashed ring + grey `REMOVED`, card at 0.42 = only in the reference, shown at the end.
- **Labels come from `lab.step_def`** (kind → label + one-line description). Unknown kinds show their kind name,
  so a new technique never needs a UI change.
- **Everywhere else** (run progress bars, the retrieved-context switch, latency rows), steps are named by id and
  shown in the version's (or the run's) order. The final context is the last list in that order.
- **Queue form:** one block per step (position numeral, id, kind, ↑ ↓, `leave out`); a step that moved gets a blue
  position numeral, and a left-out step is struck through and faded. Its settings sit under it.
- **Empty states:** with no versions, the version pages show a centred `NO VERSIONS YET` heading and a lede that
  points at the contract. Runs, Providers and Log work without versions.
