// GET /api/internal/synthetic-upload: scheduled self-check of the Desktop transcript inbox. Authenticated by
// SYNTHETIC_KEY (32+ characters, constant-time compare). Writes only made-up text; failures log "synthetic_upload_failed".
import { NextResponse } from "next/server";
import { keyMatches } from "@/lib/promote/rules";
import { runSyntheticCheck } from "@/lib/notes/inboxSynthetic";

export const dynamic = "force-dynamic";
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  const key = process.env.SYNTHETIC_KEY;
  if (!key || key.length < 32) return json({ error: "not_found" }, 404);
  if (!keyMatches(req.headers.get("authorization"), key)) return json({ error: "unauthorized" }, 401);
  const r = await runSyntheticCheck();
  if (!r.ok) console.error(JSON.stringify({ msg: "synthetic_upload_failed", step: r.step, ms: r.ms }));
  return json(r, r.ok ? 200 : 500);
}
