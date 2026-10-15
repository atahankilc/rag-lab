/** Hairline pill container with inner 24px pills. */
export function Segmented<T extends string>({
  label, value, options, onChange, ariaLabel,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; count?: number; disabled?: boolean }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {label ? <span className="seg-label">{label}</span> : null}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled}
                onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null ? <span className="count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
