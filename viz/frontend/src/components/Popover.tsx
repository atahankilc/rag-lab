import { useEffect, useRef, type ReactNode } from "react";

/** A glass panel under its anchor. Closes on Esc and on a click outside it and its anchor. */
export function Popover({ open, onClose, anchor, children, label, className = "" }: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return (
    <div ref={ref} className={`popover glass appear ${className}`} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
