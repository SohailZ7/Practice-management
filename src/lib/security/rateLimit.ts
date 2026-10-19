// Small in-memory fixed-window rate limiter. Pure apart from its own Map, so it is unit-tested with a fake clock.
//
// LIMITATION: counts live in one process. On Cloud Run with several instances each instance counts separately, so the
// effective limit is (limit x instances) and a restart resets it. For a hard limit put Cloud Armor (or a shared store
// such as Redis/Memorystore) in front. This limiter is a speed bump against scripted guessing and runaway clients.

export type LimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

export function createLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }) {
  const { limit, windowMs, maxKeys = 5000 } = opts;
  const buckets = new Map<string, { start: number; count: number }>();

  return {
    hit(key: string, now = Date.now()): LimitResult {
      let b = buckets.get(key);
      if (!b || now - b.start >= windowMs || now < b.start) {
        if (!b && buckets.size >= maxKeys) {
          for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
          if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
        }
        b = { start: now, count: 0 };
        buckets.set(key, b);
      }
      b.count++;
      const retryAfterSec = Math.max(1, Math.ceil((b.start + windowMs - now) / 1000));
      return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterSec };
    },
    size: () => buckets.size,
  };
}

/** The client address as seen by the platform's front end: the entry `hops` from the right of X-Forwarded-For. */
export function clientIp(forwardedFor: string | null, hops = 1): string {
  const parts = (forwardedFor ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "unknown";
  return parts[Math.max(0, parts.length - hops)];
}

export type Rule = { name: string; limit: number; windowMs: number; by: "ip" | "user" };

/** Which rule (if any) applies to a request. */
export function ruleFor(method: string, pathname: string, isServerAction: boolean): Rule | null {
  if (/^\/api\/auth\/(callback|signin)(\/|$)/.test(pathname)) return { name: "signin", limit: 30, windowMs: 10 * 60_000, by: "ip" };
  if (pathname === "/api/auth/signout" || pathname === "/api/auth/csrf") return { name: "auth", limit: 60, windowMs: 10 * 60_000, by: "ip" };
  if (/^\/api\/schedule\/import(\/|$)/.test(pathname)) return { name: "import", limit: 20, windowMs: 60_000, by: "user" };
  if (pathname === "/ledger/export") return { name: "export", limit: 10, windowMs: 60_000, by: "user" };
  if (pathname === "/api/session/touch") return { name: "touch", limit: 30, windowMs: 60_000, by: "user" };
  if (isServerAction && method === "POST") return { name: "action", limit: 300, windowMs: 60_000, by: "user" };
  return null;
}
