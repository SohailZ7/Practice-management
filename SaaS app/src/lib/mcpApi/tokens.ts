// Tokens for the Claude MCP server. Pure apart from node:crypto.
// A token is "bbcmcp_" + 32 random bytes (base64url), shown once. Only its SHA-256 hash is stored (ApiToken.tokenHash).
import { createHash, randomBytes } from "node:crypto";

export const TOKEN_PREFIX = "bbcmcp_";
/** Short-lived HttpOnly cookie that carries a freshly issued token to the admin page (never put it in a URL). */
export const NEW_TOKEN_COOKIE = "mcp_new_token";
export const SCOPES = ["tasks", "feedback"] as const;
export type Scope = (typeof SCOPES)[number];
export const DEFAULT_TTL_DAYS = 90;
export const MAX_TTL_DAYS = 365;

export function newApiToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashApiToken(token) };
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** "Authorization: Bearer bbcmcp_..." -> token, or null for anything else (including desktop tokens). */
export function apiBearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(bbcmcp_[A-Za-z0-9_-]{20,})$/.exec(header ?? "");
  return m ? m[1] : null;
}

export function isScope(v: string): v is Scope {
  return (SCOPES as readonly string[]).includes(v);
}

export function clampTtlDays(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TTL_DAYS;
  return Math.min(n, MAX_TTL_DAYS);
}

export function expiryFrom(days: number, now = Date.now()): Date {
  return new Date(now + days * 86_400_000);
}
