// POST /api/internal/promote: receives one task or feedback item promoted from staging. Production only: answers 404 when
// APP_ENV=staging or PROMOTE_SERVICE_KEY is not configured. Authenticated by the shared service key (constant-time compare),
// idempotent by (kind, sourceId), rate limited in middleware, audited with ids only.
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { logError } from "@/lib/safeLog";
import { ACTOR, receivePromotion } from "@/lib/promote/receive";
import { MAX_BODY, keyMatches, parsePromote, receiverEnabled } from "@/lib/promote/rules";

export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  if (!receiverEnabled()) return json({ error: "not_found" }, 404);
  if (!keyMatches(req.headers.get("authorization"), process.env.PROMOTE_SERVICE_KEY)) {
    await audit(ACTOR, "promote.denied", "bad or missing key");
    return json({ error: "unauthorized" }, 401);
  }
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad_request" }, 400);
    }
    const parsed = parsePromote(body);
    if (!parsed.ok) {
      await audit(ACTOR, "promote.rejected", parsed.error);
      return json({ error: parsed.error, ...(parsed.kinds ? { kinds: parsed.kinds } : {}) }, parsed.status);
    }
    const r = await receivePromotion(parsed.value);
    return json(r, r.status === "created" ? 201 : 200);
  } catch (e) {
    logError("promote receive failed", e);
    return json({ error: "server_error" }, 500);
  }
}
