import { useEffect, useRef, useState } from "react";
import { useAuth } from "../state/auth";

/** Asks for a login. Opens by itself on the first visit; "Just view" keeps the UI read-only. */
export function LoginDialog() {
  const { asking, dismiss, login } = useAuth();
  const ref = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (asking && !d.open) {
      setError(null);
      setPassword("");
      d.showModal();
    } else if (!asking && d.open) d.close();
  }, [asking]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="login-dialog glass" aria-labelledby="login-title"
            onCancel={(e) => { e.preventDefault(); dismiss(); }}>
      <form className="login-form" onSubmit={submit}>
        <h2 id="login-title" className="login-title">Log in</h2>
        <p className="lede">Log in to do more than view.</p>

        <label className="login-field">
          <span className="label">Username</span>
          <input className="input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                 required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="login-field">
          <span className="label">Password</span>
          <input className="input" name="password" type="password" autoComplete="current-password" required
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error ? <p className="login-error" role="alert">{error}</p> : null}

        <div className="login-actions">
          <button type="submit" className="pill" disabled={busy || !username.trim() || !password}>
            {busy ? "Logging in…" : "Log in"}
          </button>
          <button type="button" className="link" onClick={dismiss}>Just view</button>
        </div>
      </form>
    </dialog>
  );
}
