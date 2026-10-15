/** 64px hairline circle with a spinning blue arc. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <div className="ring" />
      <div className="text">{label}</div>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return <p className="error-note" role="alert">{message}</p>;
}

/** Centred in the visual area. */
export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}
