// The Fields sheet: every field the page found in this corpus, and how each one is shown.
// Changes are saved in the database per corpus name (lab.field_style) and written to the log.

import { useState } from "react";
import { useSetFieldStyle } from "../api/hooks";
import type { FieldKind, JsonObject } from "../api/types";
import { ErrorNote } from "../components/Loading";
import { Inspector } from "../components/Inspector";
import { Segmented } from "../components/Segmented";
import { LOCKED_HINT, LoginHint, useAuth } from "../state/auth";
import { type Field, COLOR_CHOICES, categoryColors, GROUP_LABEL, OUTCOME_COLORS, OUTCOME_TEXT, type Outcome } from "../lib/fields";

const KINDS: { value: FieldKind; label: string }[] = [
  { value: "category", label: "Category" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "text", label: "Text" },
];

const KIND_TEXT: Record<FieldKind, string> = {
  category: "a few distinct values: one colour each, filter by value",
  number: "a measure: coloured dark to light, filter by range",
  date: "a point in time: coloured old to new, filter by range",
  text: "free text: shown and searched, not coloured",
};

export function FieldsInspector({ fields, corpusName, onClose, colorId, setColor }: {
  fields: Field[];
  corpusName: string | undefined;
  onClose: () => void;
  colorId: string | undefined;
  setColor: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(colorId ?? null);
  const groups = [...new Set(fields.map((f) => f.group))];
  const styled = fields.filter((f) => f.style).length;

  return (
    <Inspector open onClose={onClose} label="Fields" layer="Fields"
               what={`Found in the data of ${corpusName ?? "this corpus"}. Changes are saved for that corpus and logged.`}
               title={`${fields.length} fields${styled ? ` · ${styled} adjusted` : ""}`}>
      <LoginHint what="rename, retype, hide or recolour fields" />
      {groups.map((g) => (
        <section key={g} className="inspector-section">
          <h3 className="section-head">{GROUP_LABEL[g]}</h3>
          <div className="fields-list">
            {fields.filter((f) => f.group === g).map((f) => (
              <FieldBlock key={f.id} field={f} open={openId === f.id} corpusName={corpusName}
                          onToggle={() => setOpenId(openId === f.id ? null : f.id)}
                          coloured={colorId === f.id} setColor={setColor} />
            ))}
          </div>
        </section>
      ))}
    </Inspector>
  );
}

function FieldBlock({ field, open, onToggle, corpusName, coloured, setColor }: {
  field: Field;
  open: boolean;
  onToggle: () => void;
  corpusName: string | undefined;
  coloured: boolean;
  setColor: (id: string) => void;
}) {
  const save = useSetFieldStyle();
  const { canWrite } = useAuth();
  const hint = canWrite ? undefined : LOCKED_HINT;
  const write = (style: JsonObject) => canWrite && corpusName && save.mutate({ corpus_name: corpusName, field: field.id, style });
  const summary = field.distinct <= 1 ? "one value everywhere"
    : field.kind === "category" ? `${field.distinct} values`
    : field.kind === "text" ? `${field.distinct} distinct`
    : field.kind;

  return (
    <div className={`field-block ${field.hidden ? "is-hidden" : ""}`}>
      <button type="button" className="field-head" aria-expanded={open} onClick={onToggle}>
        <span className="field-name">
          {field.style ? <i className="mark changed" aria-label="adjusted" /> : null}
          {field.label}
          {coloured ? <span className="micro-pill">colour</span> : null}
        </span>
        <span className="muted">{field.hidden ? "hidden" : summary}</span>
      </button>

      {open ? (
        <div className="field-edit appear">
          <div className="kv-row"><span className="k">field</span><span className="v mono">{field.id}</span></div>
          <div className="kv-row"><span className="k">filled in</span><span className="v">{field.present} chunks</span></div>

          <label className="field-row">
            <span className="label">Name</span>
            <input className="input" defaultValue={field.label} key={field.label} disabled={!canWrite} title={hint}
                   onBlur={(e) => { if (e.target.value.trim() !== field.label) write({ label: e.target.value.trim() || null }); }}
                   onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          </label>

          <div className="field-row">
            <span className="label">Type · detected {field.detected}</span>
            <Segmented ariaLabel={`Type of ${field.label}`} value={field.kind}
                       options={KINDS} disabled={!canWrite} title={hint}
                       onChange={(k) => write({ kind: k === field.detected ? null : k })} />
            <span className="field-hint">{KIND_TEXT[field.kind]}</span>
          </div>

          <div className="field-row in-line">
            <button type="button" role="switch" className="toggle" aria-checked={!field.hidden}
                    aria-label={`Show ${field.label}`} disabled={!canWrite} title={hint}
                    onClick={() => write({ hidden: !field.hidden })} />
            <span>{field.hidden ? "Hidden: not offered for colour or filters" : "Shown"}</span>
            {!field.hidden && field.kind !== "text" && field.distinct > 1 && !coloured ? (
              <button type="button" className="chip" onClick={() => setColor(field.id)}>Colour by this</button>
            ) : null}
          </div>

          {field.kind === "category" ? <ValueColors field={field} write={write} locked={!canWrite} /> : null}

          <div className="field-row in-line">
            <button type="button" className="chip" disabled={!field.style || !canWrite} title={hint} onClick={() => write({})}>
              Reset to detected
            </button>
            {save.isPending ? <span className="muted">Saving…</span> : null}
          </div>
          {save.error ? <ErrorNote error={save.error} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One row per value: its colour (click to pick from the palette), and how many chunks have it. */
function ValueColors({ field, write, locked }: { field: Field; write: (s: JsonObject) => void; locked: boolean }) {
  const [picking, setPicking] = useState<string | null>(null);
  const outcome = field.id === "retrieval.outcome";
  const { list } = categoryColors(field, outcome ? OUTCOME_COLORS : {});
  const byValue = new Map(list.map((c) => [c.value, c]));
  return (
    <div className="field-row">
      <span className="label">Colours · the 8 most common values get one; the rest share grey</span>
      <ul className="value-colors">
        {field.categories.slice(0, 30).map((c) => {
          const col = byValue.get(c.value);
          return (
            <li key={c.value}>
              <button type="button" className="swatch" aria-label={`Colour of ${c.value}`} aria-expanded={picking === c.value}
                      disabled={locked} title={locked ? LOCKED_HINT : undefined}
                      style={{ background: col ? `var(${col.token})` : "var(--ink-3)", opacity: col ? 1 : 0.5 }}
                      onClick={() => setPicking(picking === c.value ? null : c.value)} />
              <span className="value-name">
                {c.value}
                {outcome && OUTCOME_TEXT[c.value as Outcome] ? <span className="muted"> · {OUTCOME_TEXT[c.value as Outcome]}</span> : null}
              </span>
              <span className="muted">{c.count}</span>
              {picking === c.value && !locked ? (
                <div className="swatches" role="group" aria-label={`Pick a colour for ${c.value}`}>
                  {COLOR_CHOICES.map((t) => (
                    <button key={t} type="button" className="swatch" aria-pressed={col?.token === t} aria-label={t.replace("--", "")}
                            style={{ background: `var(${t})` }}
                            onClick={() => { write({ colors: { [c.value]: t } }); setPicking(null); }} />
                  ))}
                  <button type="button" className="chip" disabled={!field.style?.colors?.[c.value]}
                          onClick={() => { write({ colors: { [c.value]: null } }); setPicking(null); }}>Auto</button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

