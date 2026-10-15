/** Hairline pill container with inner 24px pills. */
export function Segmented<T extends string>({
  label, value, options, onChange, ariaLabel, disabled, title,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; count?: number; disabled?: boolean }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  /** every option off, e.g. a setting a logged-out visitor can't change */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel} title={title}>
      {label ? <span className="seg-label">{label}</span> : null}
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={disabled || o.disabled}
                onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null ? <span className="count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
