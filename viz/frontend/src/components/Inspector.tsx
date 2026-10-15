import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** The right-hand sheet that shows where a number came from. Esc closes it. */
export function Inspector({
  open, onClose, layer, layerMark, what, title, figure, children, label, wide,
}: {
  open: boolean;
  onClose: () => void;
  layer: string;
  layerMark?: ReactNode;
  what?: string;
  title: ReactNode;
  figure?: ReactNode;
  children?: ReactNode;
  label: string;
  /** 520px instead of 440px, for content that needs room (side-by-side comparisons) */
  wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) ref.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  return (
    <aside ref={ref} className={`inspector field ${wide ? "wide" : ""}`} aria-label={label} tabIndex={-1}>
      <button type="button" className="icon-btn inspector-close" onClick={onClose} aria-label="Close inspector">
        <X />
      </button>
      <header className="inspector-head">
        <div className="inspector-layer">
          {layerMark}
          <span>{layer}</span>
        </div>
        {what ? <p className="inspector-what">{what}</p> : null}
        <h2 className="inspector-title">{title}</h2>
      </header>
      {figure ? <div className="inspector-figure">{figure}</div> : null}
      <div className="inspector-body">{children}</div>
    </aside>
  );
}

/** A titled group of hairline-railed items inside the inspector. */
export function InspectorSection({ title, count, children }: { title: string; count?: ReactNode; children: ReactNode }) {
  return (
    <section className="inspector-section">
      <h3 className="section-head">
        {title}
        {count != null ? <span className="count">{count}</span> : null}
      </h3>
      <div className="railed">{children}</div>
    </section>
  );
}
