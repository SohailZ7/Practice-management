// Thin HTTP client for /api/mcp/v1. The token is only ever sent as a bearer header; never logged or echoed.

export type Config = { baseUrl: string; token: string };

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
  }
}

/** Reads BBC_API_URL and BBC_API_TOKEN. Plain http is allowed only for localhost. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const raw = env.BBC_API_URL?.trim();
  const token = env.BBC_API_TOKEN?.trim();
  if (!raw || !token) throw new Error("Set BBC_API_URL and BBC_API_TOKEN (see README).");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("BBC_API_URL is not a valid URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("BBC_API_URL must be https (http is only allowed for localhost).");
  if (!token.startsWith("bbcmcp_")) throw new Error("BBC_API_TOKEN does not look like a Claude token (bbcmcp_...).");
  return { baseUrl: url.origin, token };
}

export type Fetch = typeof fetch;

export function makeClient(cfg: Config, fetchImpl: Fetch = fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${cfg.baseUrl}/api/mcp/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", // never follow a redirect with the token attached
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new ApiFailure(res.status, data.error ?? "error", data.message);
    return data as T;
  }
  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body: unknown) => call<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
    del: <T>(path: string) => call<T>("DELETE", path),
  };
}

export type Client = ReturnType<typeof makeClient>;

/** One short line for the model; no stack traces, no URLs, no token. */
export function describeError(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.status === 401) return "Not authorized: the token is missing, expired or revoked. Ask an admin for a new one.";
    if (e.status === 403) return "Forbidden: that user may not do this.";
    if (e.status === 404) return "Task not found.";
    if (e.status === 422 && e.code === "phi_blocked") return `Refused: ${e.detail ?? "text looks like patient information"} Remove it and retry.`;
    if (e.status === 429) return "Rate limited. Wait a minute and retry.";
    if (e.status >= 500) return "The practice app had an error. Try again later.";
    return `Invalid request${e.detail ? `: ${e.detail}` : "."}`;
  }
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "The practice app did not respond in time.";
  return "Could not reach the practice app.";
}
