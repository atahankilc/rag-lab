import { useEffect, useRef, useState } from "react";
import { motionOff } from "../state/motion";

/**
 * A number that glides to its new value (ease-out, `ms` long) instead of jumping, so a score counts up when
 * a question opens. Returns the value to show this frame. With reduced motion it jumps.
 */
export function useTween(target: number | null | undefined, ms = 700): number | null {
  const [shown, setShown] = useState<number | null>(target ?? null);
  const from = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (target == null) {
      setShown(null);
      return;
    }
    if (motionOff()) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = a + (target - a) * (1 - Math.pow(1 - t, 4));
      setShown(v);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame.current);
      from.current = 0;
    };
  }, [target, ms]);

  return shown;
}
