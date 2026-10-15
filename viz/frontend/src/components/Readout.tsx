import type { Direction } from "../lib/format";

/** A label above a big light numeral, with a small delta beside it. */
export function Readout({
  label, value, unit, delta, dir = "flat", size = 28, title,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  dir?: Direction | "none";
  size?: 20 | 28 | 34;
  title?: string;
}) {
  return (
    <div className="readout" title={title}>
      <div className="label">{label}</div>
      <div className="readout-row">
        <span className={`num num-${size}`}>{value}</span>
        {unit ? <span className="readout-unit">{unit}</span> : null}
        {delta ? <span className={`delta ${dir === "rise" || dir === "fall" ? dir : ""}`}>{delta}</span> : null}
      </div>
    </div>
  );
}
