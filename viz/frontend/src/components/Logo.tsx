/** Single-stroke line mark: three nodes on a rising path, the last one swept. 27px high. */
export function Logo() {
  return (
    <svg className="logo" width="27" height="27" viewBox="0 0 27 27" fill="none" aria-hidden="true">
      <path d="M3 21 L11 13 L16 17 L24 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="6" r="2.2" fill="var(--sweep-hi)" />
    </svg>
  );
}
