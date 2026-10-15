import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// The login guard. Logging in happens here, in the dev server, so the browser never holds a token
// it could read: the session lives in an HttpOnly cookie, and the dev server turns it into a
// short-lived JWT only for a write whose session is still live.
//
//   POST /auth/login    {username, password} -> sets the cookie (30 days), returns {username, expires_at}
//   GET  /auth/session  -> {username, expires_at}, or {username: null}
//   POST /auth/logout   -> ends the session, clears the cookie
//   /api writes         -> 401 without a live session; otherwise forwarded as web_writer
//
// Every POST (login, logout, writes) must come from this page: another origin gets 403, even one on
// another port of 127.0.0.1. Writes must be JSON (415 otherwise), so a plain HTML form can't send one.
// `vite preview` is read-only: it proxies reads, refuses every write and login (403), and is never logged in.
//
// Users and sessions are in the database (migration 20261015000009_web_login.sql). The dev server
// talks to them as web_auth, a role the browser can't take. There is no sign-up: `make user NAME=...`.

const COOKIE = "lab_session";
const MAX_AGE = 30 * 24 * 3600;   // matches the database's 30 days

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

/** A JWT for PostgREST, valid for five minutes. */
export function signToken(secret: string, role: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 300 }));
  const signature = createHmac("sha256", secret).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}

function readCookie(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

function setCookie(res: ServerResponse, token: string | null) {
  const value = token == null ? `${COOKIE}=; Max-Age=0` : `${COOKIE}=${encodeURIComponent(token)}; Max-Age=${MAX_AGE}`;
  res.setHeader("Set-Cookie", `${value}; Path=/; HttpOnly; SameSite=Strict`);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** A problem with the request itself: its message is safe to show the browser. */
class BadRequest extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new BadRequest(413, "The request is too large.");
  }
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new BadRequest(400, "The request is not valid JSON.");
  }
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/**
 * Whether a write comes from the UI itself. SameSite=Strict isn't enough: every port on 127.0.0.1 is
 * the same "site", so a page on another local port (Jupyter, another dev server) would still send
 * the cookie. Browsers mark each request with where it came from; a request without those headers
 * isn't from a browser page (curl), and can't carry someone else's cookie.
 */
function fromThisPage(req: IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"];
  if (site != null && site !== "same-origin") return false;
  const origin = req.headers.origin;
  return origin == null || origin === `http://${req.headers.host}`;
}

interface Session { username: string; expires_at: string }

export function authPlugin({ apiUrl, secret }: { apiUrl: string; secret: string | undefined }): Plugin {
  /** Calls one of the web_auth functions (api.login, api.web_session, api.logout). */
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    if (!secret) throw new Error("LAB_JWT_SECRET is missing from .env");
    const res = await fetch(`${apiUrl}/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${signToken(secret, "web_auth")}` },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${fn}: ${res.status} ${text}`);
    return (text ? JSON.parse(text) : null) as T;   // a void function (logout) answers with no body
  }

  const sessionOf = async (req: IncomingMessage): Promise<Session | null> => {
    const token = readCookie(req);
    return token ? call<Session | null>("web_session", { token }) : null;
  };

  return {
    name: "rag-lab-auth",
    configureServer(server) {
      // registered directly (not returned), so it runs before Vite's own /api proxy
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        try {
          const write = req.method !== "GET" && req.method !== "HEAD";
          if (write && !fromThisPage(req)) return send(res, 403, { message: "Changes can only come from this page." });

          // Vite's proxy takes every path that starts with "/api" (even "/apirpc/..."); only "/api/..." is ours
          if (url.startsWith("/api") && !url.startsWith("/api/")) return send(res, 404, { message: "Not found." });

          if (url === "/auth/login" && req.method === "POST") {
            const { username, password } = await readJson(req);
            const s = await call<(Session & { token: string }) | null>("login", {
              username: String(username ?? ""), password: String(password ?? ""),
            });
            if (!s) return send(res, 401, { message: "Wrong username or password." });
            setCookie(res, s.token);
            return send(res, 200, { username: s.username, expires_at: s.expires_at });
          }

          if (url === "/auth/session" && req.method === "GET") {
            const s = await sessionOf(req);
            if (!s && readCookie(req)) setCookie(res, null);   // expired or logged out elsewhere
            return send(res, 200, s ?? { username: null });
          }

          if (url === "/auth/logout" && req.method === "POST") {
            const token = readCookie(req);
            if (token) await call("logout", { token });
            setCookie(res, null);
            return send(res, 200, { username: null });
          }

          if (url.startsWith("/api/")) {
            delete req.headers.authorization;   // a role is only ever chosen here, never by the browser
            if (write) {
              // a plain HTML form can't send JSON, so this also stops form posts PostgREST would accept
              if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
                return send(res, 415, { message: "Writes are JSON." });
              }
              if (!(await sessionOf(req))) return send(res, 401, { message: "Log in to make changes." });
              req.headers.authorization = `Bearer ${signToken(secret!, "web_writer")}`;
            }
            delete req.headers.cookie;   // PostgREST has no use for the session token
          }
        } catch (e) {
          if (e instanceof BadRequest) return send(res, e.status, { message: e.message });
          // the details (PostgREST's answer, a missing secret) go to the terminal, not to the browser
          server.config.logger.error(`[rag-lab-auth] ${req.method} ${url}: ${e instanceof Error ? e.message : String(e)}`);
          return send(res, 502, { message: "Couldn't check the login. The dev server's terminal says why." });
        }
        next();
      });
    },
    // `vite preview` reuses the /api proxy but not configureServer: without this, it would forward the
    // browser's own Authorization header. A preview is read-only and never logged in.
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const write = req.method !== "GET" && req.method !== "HEAD";
        if (url.startsWith("/api") && !url.startsWith("/api/")) return send(res, 404, { message: "Not found." });
        if (url === "/auth/session") return send(res, 200, { username: null });
        if (url.startsWith("/auth/")) return send(res, 403, { message: "A preview is read-only: log in with `make dev`." });
        if (url.startsWith("/api/")) {
          if (write) return send(res, 403, { message: "A preview is read-only: make changes with `make dev`." });
          delete req.headers.authorization;
          delete req.headers.cookie;
        }
        next();
      });
    },
  };
}
