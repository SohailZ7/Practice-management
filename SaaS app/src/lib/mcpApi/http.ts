// Plumbing for /api/mcp/v1/*: bearer-token auth, scope check, JSON helpers. Tokens never appear in logs.
import { NextResponse } from "next/server";
import { db } from "../db";
import { audit } from "../audit";
import { logError } from "../safeLog";
import { canAccess, type Level } from "../access";
import { apiBearer, hashApiToken, type Scope } from "./tokens";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function handle(fn: (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Record<string, string> }): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.code, ...e.extra }, e.status);
      logError("mcp api error", e); // class and code only: the message may echo task text
      return json({ error: "server_error" }, 500);
    }
  };
}

/** Reads a JSON object body of at most 40 KB (a task with full notes is well under that). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 40_000) throw new ApiError(413, "too_large");
  try {
    const v = JSON.parse(text || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, "bad_request");
}

/**
 * A valid, unexpired, unrevoked token with the needed scope, owned by an active user who still has the needed
 * Tasks level. The token never grants more than that user already has in the web app.
 */
export async function authenticateApi(req: Request, need: { scope: Scope; level: Level }) {
  const raw = apiBearer(req.headers.get("authorization"));
  if (!raw) throw new ApiError(401, "unauthorized");
  const token = await db.apiToken.findUnique({ where: { tokenHash: hashApiToken(raw) } });
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) throw new ApiError(401, "unauthorized");
  const user = await db.user.findUnique({ where: { id: token.userId }, include: { access: true } });
  if (!user || !user.active) throw new ApiError(401, "unauthorized");
  if (token.scope !== need.scope || !canAccess(user, "tasks", need.level)) {
    await audit(user.email, "mcp.denied", `token ${token.id} needed ${need.scope}:${need.level}`);
    throw new ApiError(403, "forbidden");
  }
  await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { user, tokenId: token.id };
}
