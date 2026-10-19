import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/security/origin";
import { getCurrentUser, getSessionTiming } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Called only when a person acts in the browser ("Stay signed in", or mouse/keyboard use after a quiet minute).
 * Middleware has already refreshed the last-activity stamp by the time this runs; a signed-out caller gets 401.
 */
export async function POST(req: Request) {
  const cross = rejectCrossOrigin(req);
  if (cross) return cross;
  const user = await getCurrentUser();
  const timing = user ? await getSessionTiming() : null;
  if (!user || !timing) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ ok: true, ...timing }, { headers: { "Cache-Control": "no-store" } });
}
