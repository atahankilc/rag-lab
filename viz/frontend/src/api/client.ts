// A tiny PostgREST client. Paths are PostgREST URLs relative to /api, e.g.
//   get<Experiment[]>("experiments?order=ord")
// Writes go to /rpc/<function>; the dev server adds the write token (see vite.config.ts).

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body.message ?? message;
    } catch {
      // not JSON: keep the status line
    }
    if (res.status === 502 || res.status === 504) message = "The API is not reachable. Is `make db` running?";
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export async function get<T>(path: string): Promise<T> {
  return parse<T>(await fetch(`/api/${path}`));
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return parse<T>(
    await fetch(`/api/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }),
  );
}
