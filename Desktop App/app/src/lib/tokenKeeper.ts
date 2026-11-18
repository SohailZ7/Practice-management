// Keeps the sign-in alive without the person doing anything: renew the access token before it expires, so a day of
// visits never ends in "sign in again". Pure helpers; the app calls them on a timer.

/** The `exp` (seconds since 1970) inside a JWT access token, or null when it cannot be read. Never logs the token. */
export function tokenExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch { return null; }
}

export const REFRESH_AHEAD_SECONDS = 15 * 60;
export const FALLBACK_REFRESH_MS = 30 * 60_000;

/** True when the token should be renewed now: it expires within 15 minutes, or its expiry is unknown and 30 minutes passed. */
export function shouldRefresh(token: string, nowSec: number, lastRefreshMs: number, nowMs: number): boolean {
  const exp = tokenExpiry(token);
  if (exp !== null) return exp - nowSec < REFRESH_AHEAD_SECONDS;
  return nowMs - lastRefreshMs >= FALLBACK_REFRESH_MS;
}
