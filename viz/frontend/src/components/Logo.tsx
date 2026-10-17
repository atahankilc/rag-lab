import { useId } from "react";

/** Single-stroke line mark: three nodes on a rising path, the last one lit in the accent. 27px high. */
export function Logo() {
  const id = useId();
  return (
    <svg className="logo" width="27" height="27" viewBox="0 0 27 27" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="3" y1="21" x2="24" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--aurora-1)" />
          <stop offset="0.5" stopColor="var(--aurora-2)" />
          <stop offset="1" stopColor="var(--aurora-3)" />
        </linearGradient>
      </defs>
      <path
        d="M3 21 L11 13 L16 17 L24 6"
        stroke={`url(#${id})`}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="6" r="2.4" fill="var(--aurora-3)" />
      <circle cx="24" cy="6" r="5" fill="var(--aurora-3)" opacity="0.18" />
    </svg>
  );
}
