// One line per colour and mark on each page, shown in the dock's Guide panel.
// `mark` is a CSS class from base.css (.mark.<x>), or a short text glyph.

export interface GuideEntry {
  mark: string; // e.g. "mark sel", or "text:▲"
  name: string;
  text: string;
}

const common: GuideEntry[] = [
  { mark: "mark sel", name: "Blue dot", text: "The version you are looking at. ← → move through versions." },
  { mark: "mark held", name: "Filled dot", text: "A version with a finished run." },
  { mark: "mark new", name: "Ring", text: "A version without a finished run yet." },
  {
    mark: "mark rise",
    name: "Green",
    text: "Better than the reference (parent or pinned baseline). Never used for anything else.",
  },
  { mark: "mark fall", name: "Red", text: "Worse than the reference." },
];

export const GUIDES: Record<string, { title: string; entries: GuideEntry[] }> = {
  "/": {
    title: "Pipeline",
    entries: [
      {
        mark: "text:|",
        name: "Two groups",
        text: "Library: built once and shared (documents, chunks, vectors). Per question: this version's own steps, in its order.",
      },
      {
        mark: "text:→",
        name: "Funnel",
        text: "How many items each step produced for this version, with the change vs the reference.",
      },
      {
        mark: "mark changed",
        name: "Blue step mark",
        text: "The step's settings differ from the reference. With MOVED: it sits at a different place in the order.",
      },
      { mark: "mark new", name: "Hollow blue mark, NEW", text: "A step the reference doesn't have." },
      { mark: "text:◌", name: "Dashed mark, REMOVED", text: "A step only the reference has, shown faded at the end." },
      { mark: "mark held", name: "Filled step mark", text: "The step is the same as in the reference." },
      { mark: "loc", name: "LOCAL / CLOUD", text: "Where the step's model runs. Cloud has a dashed outline." },
      { mark: "text:ms", name: "Latency", text: "Median (p50) time per question for the step; p95 underneath." },
      ...common,
    ],
  },
};

GUIDES["/questions"] = {
  title: "Questions",
  entries: [
    {
      mark: "text:▲",
      name: "Green triangle",
      text: "Better than the reference by 0.1 or more on the primary metric (correctness).",
    },
    { mark: "text:▼", name: "Red triangle", text: "Worse than the reference by 0.1 or more." },
    { mark: "mark held", name: "Grey dot (table)", text: "Changed by less than 0.1." },
    { mark: "text:—", name: "Dash", text: "No reference to compare with, or the metric doesn't apply." },
    {
      mark: "text:+0.2",
      name: "Small number under a score",
      text: "Change vs the reference; green or red when it is better or worse.",
    },
    { mark: "mark held", name: "Filled dot (context)", text: "The retrieved chunk overlaps a gold evidence span." },
    { mark: "mark new", name: "Ring (context)", text: "The retrieved chunk is not relevant." },
    { mark: "mark lost", name: "Amber ×", text: "Gold evidence that no chunk in the final context covers." },
    { mark: "text:[1]", name: "Citation", text: "A source the answer cites; click it to jump to the chunk." },
    { mark: "mark sel", name: "Blue bar", text: "The question open in the inspector. ↑ ↓ move between questions." },
  ],
};

GUIDES["/compare"] = {
  title: "Compare",
  entries: [
    {
      mark: "text:+0.1",
      name: "Green change",
      text: "The timeline's version is better than the one picked in the dropdown.",
    },
    { mark: "text:−0.1", name: "Red change", text: "It is worse. Latency and cost count as better when they go down." },
    { mark: "text:±0", name: "Grey change", text: "No real difference, or a count that is neither better nor worse." },
    { mark: "text:—", name: "Dash", text: "One of the two versions has no value for this metric or setting." },
    {
      mark: "mark changed",
      name: "Blue value",
      text: "A setting's value in the timeline's version, where it differs.",
    },
    ...common,
  ],
};

GUIDES["/space"] = {
  title: "Space",
  entries: [
    {
      mark: "text:·",
      name: "Points",
      text: "Every chunk of this version, placed by a projection (UMAP, PCA, ...) of its embedding. Close = similar, roughly: the projection bends distances.",
    },
    {
      mark: "text:■",
      name: "Colours",
      text: "The field picked under Colour: a category gets one colour per value (the 8 most common; the rest share grey), a number or date runs dark to light. Fields come from the data itself.",
    },
    { mark: "text:◇", name: "Hollow diamonds", text: "Where every question lands (◇ All). Click one to pick it." },
    { mark: "text:◆", name: "White diamond", text: "The picked question." },
    {
      mark: "mark sel",
      name: "Blue points",
      text: "Its ranked list at the chosen step (final by default), with lines to the query and the rank.",
    },
    {
      mark: "mark strong",
      name: "Ink ring around blue",
      text: "A retrieved chunk that is relevant (it overlaps gold evidence).",
    },
    { mark: "mark amber-ring", name: "Amber ring", text: "A relevant chunk that step's list doesn't have." },
    {
      mark: "text:◎",
      name: "Blue wash",
      text: "The chunk open in the inspector; thin lines go to its true nearest neighbours by vector.",
    },
    {
      mark: "text:#",
      name: "map #14 (amber)",
      text: "A true neighbour that the map puts far away: the 2D/3D layout distorted that distance.",
    },
    {
      mark: "text:⬚",
      name: "3D floor",
      text: "The map lies on a floor grid and the third coordinate is height. Each point's faint shadow on the floor shows where it stands; dashed lines drop from the points that matter.",
    },
    {
      mark: "text:◐",
      name: "Faint and small",
      text: "In 3D, far points fade into the black and shrink; near ones are larger and brighter. The view turns slowly while you leave it alone.",
    },
    {
      mark: "text:↔",
      name: "Moving points",
      text: "Step the timeline to a version with the same chunks and the points glide to their place in its embedding space.",
    },
    {
      mark: "text:▯▯",
      name: "Compare",
      text: "Shows another version next to this one, with one camera for both. The chunk under the pointer gets an ink ring in the other pane (its document's chunks when the chunking differs).",
    },
    ...common,
  ],
};

GUIDES["/runs"] = {
  title: "Runs",
  entries: [
    {
      mark: "mark new",
      name: "Ring",
      text: "Queued: waiting for a backend to claim it. There is no backend yet, so it stays queued.",
    },
    {
      mark: "text:◌",
      name: "Spinning blue arc",
      text: "Running: a backend is working on it. The table refreshes every few seconds.",
    },
    {
      mark: "mark held",
      name: "Filled dot",
      text: "Done: results, metrics and events are stored and can no longer change.",
    },
    { mark: "mark lost", name: "Amber ×", text: "Failed: the error is in the inspector and the event log." },
    {
      mark: "text:▬",
      name: "Stage bars",
      text: "Progress per stage. Grey = done, blue = in progress, amber = failed.",
    },
    { mark: "text:!", name: "Amber log lines", text: "Warnings and errors the backend reported while running." },
    {
      mark: "mark changed",
      name: "Blue setting",
      text: "In the queue form: a setting changed for this one run (an override).",
    },
    { mark: "text:—", name: "Dash", text: "Not known yet, for example the duration of a run that hasn't started." },
  ],
};

GUIDES["/providers"] = {
  title: "Providers",
  entries: [
    { mark: "mark held", name: "Filled dot", text: "Ready: on, under its spend cap, and used by a version." },
    { mark: "text:◦", name: "Faded dot", text: "Ready but unused: no version names this provider yet." },
    {
      mark: "mark weak",
      name: "Amber dot",
      text: "Cap reached: spend is at or over the cap; a backend should stop calling it.",
    },
    { mark: "mark new", name: "Ring", text: "Off: a backend must not call it. The row fades to 0.42." },
    {
      mark: "text:▬",
      name: "Spend bar",
      text: "All-time spend against the cap. Grey under the cap, amber once it is reached.",
    },
    { mark: "loc", name: "LOCAL / CLOUD", text: "Where the models run. Cloud has a dashed outline." },
    { mark: "text:⏽", name: "Switch", text: "Turns the provider on or off. The change is written to the log." },
    { mark: "text:$", name: "Price", text: "Lowest to highest model price per 1M tokens; local models are free." },
  ],
};

GUIDES["/log"] = {
  title: "Log",
  entries: [
    { mark: "mark new", name: "Ring", text: "Something new was created, added or queued." },
    {
      mark: "mark held",
      name: "Filled dot",
      text: "Something existing changed state: a run started or finished, a setting changed, a note was added.",
    },
    { mark: "mark weak", name: "Amber dot", text: "A warning, for example the judge flagging answers." },
    { mark: "mark lost", name: "Amber ×", text: "A failure, for example a run that failed." },
    { mark: "mark sel", name: "Blue dot", text: "The event open in the inspector." },
    {
      mark: "text:B",
      name: "Bold line",
      text: "A milestone: a new version, a new baseline, a finished or failed run.",
    },
    { mark: "text:·", name: "Meta line", text: "Who did it (me, system or model), which version, and when." },
    { mark: "text:#", name: "Count chips", text: "How many events of each type and actor match the other filters." },
  ],
};

GUIDES["/compare/config"] = GUIDES["/compare"];
export function guideFor(pathname: string) {
  return GUIDES[pathname] ?? { title: "This page", entries: common };
}
