import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";

// Who is logged in. Without a session the UI is read-only: every control that changes data is
// disabled, while looking around, navigating and filtering still work. The dev server enforces the
// same rule for every write (vite.auth.ts), so the disabled controls are only the visible half.
// There is no sign-up: users are added with `make user NAME=...`.

export interface Session {
  username: string | null;
  expires_at?: string;
}

interface AuthState {
  username: string | null;
  expiresAt: string | undefined;
  /** true while logged in: the controls that change data are enabled */
  canWrite: boolean;
  checking: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** the login dialog */
  asking: boolean;
  ask: () => void;
  dismiss: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const ASKED = "rag-lab.login-asked"; // the dialog opens by itself once per browser session

async function authCall(method: "GET" | "POST", path: string, body?: unknown): Promise<Session> {
  const res = await fetch(`/auth/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: { message?: string } & Session = { username: null };
  try {
    data = await res.json();
  } catch {
    // not JSON: keep the status
  }
  if (!res.ok) throw new ApiError(data.message ?? `${res.status} ${res.statusText}`, res.status);
  return data;
}

function askedBefore(): boolean {
  try {
    return sessionStorage.getItem(ASKED) === "1";
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => authCall("GET", "session"),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true, // a session that ended in another tab locks this one too
  });
  const username = session.data?.username ?? null;
  const [asking, setAsking] = useState(false);

  // first visit in this browser session without a login: ask, once
  useEffect(() => {
    if (!session.isSuccess || username || askedBefore()) return;
    try {
      sessionStorage.setItem(ASKED, "1");
    } catch {
      // storage blocked: it may ask again after a reload
    }
    setAsking(true);
  }, [session.isSuccess, username]);

  const loginM = useMutation({
    mutationFn: (args: { username: string; password: string }) => authCall("POST", "login", args),
    onSuccess: (s) => {
      qc.setQueryData(["session"], s);
      setAsking(false);
    },
  });
  const logoutM = useMutation({
    mutationFn: () => authCall("POST", "logout"),
    onSuccess: () => qc.setQueryData(["session"], { username: null }),
    // the server may not have ended the session: ask again rather than show a logout that didn't happen
    onError: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });

  const { mutateAsync: loginAsync } = loginM;
  const { mutate: logoutNow } = logoutM;
  const login = useCallback(
    async (u: string, p: string) => {
      await loginAsync({ username: u, password: p });
    },
    [loginAsync],
  );
  const logout = useCallback(() => logoutNow(), [logoutNow]);
  const ask = useCallback(() => setAsking(true), []);
  const dismiss = useCallback(() => setAsking(false), []);

  const value = useMemo<AuthState>(
    () => ({
      username,
      expiresAt: session.data?.expires_at,
      canWrite: username != null,
      checking: session.isLoading,
      login,
      logout,
      asking,
      ask,
      dismiss,
    }),
    [username, session.data?.expires_at, session.isLoading, login, logout, asking, ask, dismiss],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** The hint shown on a disabled control. */
export const LOCKED_HINT = "Log in to make changes";

/** A one-line note in place of what a logged-out visitor can't do, with a link to the dialog. */
export function LoginHint({ what = "make changes" }: { what?: string }) {
  const { canWrite, ask } = useAuth();
  if (canWrite) return null;
  return (
    <p className="login-hint">
      <button type="button" className="link" onClick={ask}>
        Log in
      </button>{" "}
      to {what}.
    </p>
  );
}
