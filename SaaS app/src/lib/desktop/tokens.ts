// Desktop API tokens (requirements v19, API-2, API-9). Pure apart from node:crypto.
//
// Access token: short-lived, signed with HMAC-SHA256 ("v1.<payload>.<signature>"). It names the user and the session row,
// and the server also checks that the session is still active, so revoking a session takes effect at once.
// Refresh token: 32 random bytes, shown once; only its SHA-256 hash is stored.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_TTL_SEC = 60 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AccessClaims = { uid: string; sid: string; exp: number };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url");
}

export function signAccessToken(claims: AccessClaims, secret: string): string {
  const payload = b64(JSON.stringify(claims));
  return `v1.${payload}.${sign(payload, secret)}`;
}

/** Returns the claims, or null for anything malformed, tampered with or expired. `nowSec` is injectable for tests. */
export function verifyAccessToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = Buffer.from(sign(parts[1], secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<AccessClaims>;
    if (typeof c.uid !== "string" || typeof c.sid !== "string" || typeof c.exp !== "number") return null;
    if (c.exp <= nowSec) return null;
    return { uid: c.uid, sid: c.sid, exp: c.exp };
  } catch {
    return null;
  }
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = b64(randomBytes(32));
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** "Authorization: Bearer <token>" -> token, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

/** The signing secret: its own variable when set, otherwise derived from NEXTAUTH_SECRET so no new setup is required. */
export function desktopSecret(env: Record<string, string | undefined> = process.env): string {
  const own = env.DESKTOP_TOKEN_SECRET;
  if (own) return own;
  const base = env.NEXTAUTH_SECRET;
  if (!base) throw new Error("DESKTOP_TOKEN_SECRET or NEXTAUTH_SECRET must be set");
  return createHmac("sha256", base).update("desktop-api-v1").digest("base64");
}

export function sessionExpiry(now = Date.now()): Date {
  return new Date(now + REFRESH_TTL_MS);
}
