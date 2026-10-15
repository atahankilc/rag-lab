// The Space page's filter row: one chip per active filter, "+ Filter" to add one, and a text search.
// Filters hide points; the search keeps every point and dims the ones that don't match.

import { Plus, Search } from "lucide-react";
import { useRef, useState } from "react";
import { Popover } from "../components/Popover";
import { type Field, type Filter, type Scale, formatFieldValue, GROUP_LABEL, usable } from "../lib/fields";

export type Filters = Record<string, Filter>;

function describe(f: Filter, field: Field): string {
  if (f.kind === "in") return f.values.length <= 2 ? f.values.join(", ") : `${f.values.length} values`;
  const lo = f.min != null ? formatFieldValue(f.min, field.kind) : "…";
  const hi = f.max != null ? formatFieldValue(f.max, field.kind) : "…";
  return `${lo} – ${hi}`;
}

export function FilterRow({
  fields,
  filters,
  setFilters,
  search,
  setSearch,
  scale,
  colorField,
}: {
  fields: Field[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  search: string;
  setSearch: (s: string) => void;
  scale: Scale | undefined;
  colorField: Field | undefined;
}) {
  const [open, setOpen] = useState<string | null>(null); // a field id, or "+" for the field list
  const addRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const byId = new Map(fields.map((f) => [f.id, f]));
  const active = Object.keys(filters).filter((id) => byId.has(id));
  const set = (id: string, f: Filter | null) => {
    const next = { ...filters };
    if (f) next[id] = f;
    else delete next[id];
    setFilters(next);
  };

  return (
    <div className="space-filters filter-row">
      {active.map((id) => {
        const field = byId.get(id)!;
        return (
          <span key={id} className="filter-wrap">
            <span className="chip filter-chip set">
              <button
                ref={(el) => {
                  chipRefs.current.set(id, el);
                }}
                type="button"
                aria-expanded={open === id}
                onClick={() => setOpen(open === id ? null : id)}
              >
                <span className="muted">{field.label}</span> {describe(filters[id], field)}
              </button>
              <button
                type="button"
                className="x"
                aria-label={`Remove the ${field.label} filter`}
                onClick={() => {
                  set(id, null);
                  setOpen(null);
                }}
              >
                ×
              </button>
            </span>
            <Popover
              open={open === id}
              onClose={() => setOpen(null)}
              anchor={{ current: chipRefs.current.get(id) ?? null }}
              label={`Filter by ${field.label}`}
            >
              <FilterEditor
                field={field}
                value={filters[id]}
                onChange={(f) => set(id, f)}
                scale={colorField?.id === id ? scale : undefined}
              />
            </Popover>
          </span>
        );
      })}

      <span className="filter-wrap">
        <button
          ref={addRef}
          type="button"
          className="chip filter-chip"
          aria-expanded={open === "+"}
          onClick={() => setOpen(open === "+" ? null : "+")}
        >
          <Plus size={12} /> Filter
        </button>
        <Popover open={open === "+"} onClose={() => setOpen(null)} anchor={addRef} label="Add a filter">
          <FieldList
            fields={fields.filter((f) => usable(f) && !filters[f.id])}
            onPick={(f) => {
              setOpen(f.id);
              set(f.id, f.kind === "category" ? { kind: "in", values: [] } : { kind: "range", min: f.min, max: f.max });
            }}
          />
        </Popover>
      </span>

      <label className="space-search">
        <Search aria-hidden />
        <span className="sr-only">Search chunks</span>
        <input
          className="input"
          type="search"
          placeholder="Search text and titles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
    </div>
  );
}

/** The fields one can filter by, grouped, with their kind and number of values. */
function FieldList({ fields, onPick }: { fields: Field[]; onPick: (f: Field) => void }) {
  if (!fields.length) return <p className="pop-empty">No other field varies across these chunks.</p>;
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <div className="pop-list">
      {groups.map((g) => (
        <div key={g}>
          <div className="axis pop-group">{GROUP_LABEL[g]}</div>
          {fields
            .filter((f) => f.group === g)
            .map((f) => (
              <button key={f.id} type="button" className="pop-row" onClick={() => onPick(f)}>
                <span className="pop-name">{f.label}</span>
                <span className="muted">{f.kind === "category" ? `${f.distinct} values` : f.kind}</span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}

function FilterEditor({
  field,
  value,
  onChange,
  scale,
}: {
  field: Field;
  value: Filter;
  onChange: (f: Filter) => void;
  scale: Scale | undefined;
}) {
  if (field.kind === "category" && value.kind === "in") {
    const max = field.categories[0]?.count ?? 1;
    const color = new Map(scale?.categories.map((c) => [c.value, c.token]));
    return (
      <div className="pop-list" role="group" aria-label={`${field.label} values`}>
        {field.categories.slice(0, 60).map((c) => {
          const on = value.values.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              className="pop-value"
              aria-pressed={on}
              onClick={() =>
                onChange({
                  kind: "in",
                  values: on ? value.values.filter((v) => v !== c.value) : [...value.values, c.value],
                })
              }
            >
              <span className="pop-name">
                {color.get(c.value) ? (
                  <i className="mark" style={{ background: `var(${color.get(c.value)})` }} />
                ) : null}
                {c.value}
              </span>
              <span className={`bar ${on ? "sel" : ""}`}>
                <span style={{ width: `${(c.count / max) * 100}%` }} />
              </span>
              <span className="muted">{c.count}</span>
            </button>
          );
        })}
        {field.categories.length > 60 ? (
          <p className="pop-empty">{field.categories.length - 60} more values; search to narrow down.</p>
        ) : null}
      </div>
    );
  }
  if (value.kind !== "range") return null;
  const date = field.kind === "date";
  const show = (v: number | null) => (v == null ? "" : date ? new Date(v).toISOString().slice(0, 10) : String(v));
  const read = (s: string) => (s === "" ? null : date ? Date.parse(s) : Number(s));
  return (
    <div className="pop-range">
      <label>
        <span className="label">From</span>
        <input
          className="input"
          type={date ? "date" : "number"}
          defaultValue={show(value.min)}
          onChange={(e) => onChange({ ...value, min: read(e.target.value) })}
        />
      </label>
      <label>
        <span className="label">To</span>
        <input
          className="input"
          type={date ? "date" : "number"}
          defaultValue={show(value.max)}
          onChange={(e) => onChange({ ...value, max: read(e.target.value) })}
        />
      </label>
      <p className="pop-empty">
        All values: {formatFieldValue(field.min, field.kind)} – {formatFieldValue(field.max, field.kind)}
      </p>
    </div>
  );
}
