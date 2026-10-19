// Pure session-expiry rules (automatic logoff). No framework imports so they run in middleware and tests.
// Timestamps are epoch milliseconds stored inside the encrypted Auth.js JWT. Only the server writes them.

export const WARNING_MS = 2 * 60 * 1000;
/** A stamp this far in the future is not clock skew between instances; treat the token as invalid. */
export const MAX_SKEW_MS = 5 * 60 * 1000;
/** The cookie is only rewritten when its last-activity stamp is at least this old. */
export const REFRESH_AFTER_MS = 30 * 1000;

export type SessionPolicy = { idleMs: number; maxMs: number };

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** SESSION_IDLE_MINUTES (default 15) and SESSION_MAX_HOURS (default 12). Bad values fall back to the defaults. */
export function sessionPolicy(env: Record<string, string | undefined> = process.env): SessionPolicy {
  const idleMs = Math.round(positive(env.SESSION_IDLE_MINUTES, 15) * 60_000);
  const maxMs = Math.round(positive(env.SESSION_MAX_HOURS, 12) * 3_600_000);
  return { idleMs: Math.min(idleMs, maxMs), maxMs };
}

export type Stamps = { authAt?: unknown; lastActive?: unknown };

export type Verdict =
  | { ok: true; idleDeadline: number; absoluteDeadline: number; deadline: number }
  | { ok: false; reason: "missing" | "invalid" | "idle" | "absolute" };

const isStamp = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Expired at exactly the limit (elapsed >= limit). Absolute limit wins when both have passed. */
export function checkSession(stamps: Stamps | null | undefined, now: number, policy: SessionPolicy): Verdict {
  if (!stamps || (stamps.authAt === undefined && stamps.lastActive === undefined)) return { ok: false, reason: "missing" };
  const { authAt, lastActive } = stamps;
  if (!isStamp(authAt) || !isStamp(lastActive) || !Number.isFinite(now)) return { ok: false, reason: "invalid" };
  if (authAt - now > MAX_SKEW_MS || lastActive - now > MAX_SKEW_MS) return { ok: false, reason: "invalid" };
  const absoluteDeadline = authAt + policy.maxMs;
  if (now >= absoluteDeadline) return { ok: false, reason: "absolute" };
  // Small forward skew counts as "just now"; the idle clock never runs backwards.
  const lastSeen = Math.min(lastActive, now);
  const idleDeadline = lastSeen + policy.idleMs;
  if (now >= idleDeadline) return { ok: false, reason: "idle" };
  return { ok: true, idleDeadline, absoluteDeadline, deadline: Math.min(idleDeadline, absoluteDeadline) };
}

/** Whether a valid session's cookie should be rewritten with a newer last-activity stamp. */
export function shouldRefresh(lastActive: number, now: number): boolean {
  return now - lastActive >= REFRESH_AFTER_MS || lastActive > now;
}
