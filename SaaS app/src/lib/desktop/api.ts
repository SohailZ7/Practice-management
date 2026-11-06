// Shared plumbing for /api/desktop/v1/* route handlers (requirements v19, section 5.7).
import { NextResponse } from "next/server";
import { db } from "../db";
import { audit } from "../audit";
import { canAccess, normalizeEmail, type Level, type ModuleName } from "../access";
import { bearerToken, desktopSecret, hashRefreshToken, verifyAccessToken } from "./tokens";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof ApiError) {
        // Code, status and path only (no query, no body): enough to tell which rule refused, nothing that can hold PHI.
        console.warn(JSON.stringify({ msg: "desktop api refused", method: req.method, path: new URL(req.url).pathname, status: e.status, code: e.code }));
      }
      if (e instanceof ApiError) return json({ error: e.code }, e.status);
      console.error("desktop api error"); // never log the error text: it may echo patient values
      return json({ error: "server_error" }, 500);
    }
  };
}

/** Reads a JSON body of at most 8 KB; anything else is a 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  // A transcript is the one large body this API accepts; everything else is a few hundred bytes.
  if (text.length > 300_000) throw new ApiError(413, "too_large");
  try {
    const v = JSON.parse(text || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, "bad_request");
}

/**
 * API-2, API-3, API-9: a valid token, an active session, an active user, and the module level needed.
 *
 * Two kinds of token are accepted. A signed, short-lived access token comes from the Google sign-in exchange. A
 * pairing token is the long opaque string the practice app shows once when a recorder is connected; the recorder
 * stores it and sends it directly, which saves building a sign-in flow into a device that only records.
 */
export async function authenticate(req: Request, need?: { module: ModuleName; level: Level }) {
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) throw new ApiError(401, "unauthorized");

  const claims = verifyAccessToken(token, desktopSecret());
  const session = claims
    ? await db.desktopSession.findUnique({ where: { id: claims.sid } })
    : await db.desktopSession.findUnique({ where: { tokenHash: hashRefreshToken(token) } });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new ApiError(401, "unauthorized");
  if (claims && session.userId !== claims.uid) throw new ApiError(401, "unauthorized");

  const user = await db.user.findUnique({ where: { id: session.userId }, include: { access: true } });
  if (!user || !user.active) throw new ApiError(401, "unauthorized");
  if (need && !canAccess(user, need.module, need.level)) {
    await audit(user.email, "desktop.denied", `needed ${need.module}:${need.level}`);
    throw new ApiError(403, "forbidden");
  }
  // A pairing token in daily use should not quietly expire mid-clinic.
  if (!claims) {
    await db.desktopSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { user, session };
}

export const emailOf = (e: string) => normalizeEmail(e);
