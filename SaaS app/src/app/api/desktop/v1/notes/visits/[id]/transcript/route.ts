import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";

export const dynamic = "force-dynamic";

const MAX_TRANSCRIPT = 200_000;

/**
 * The recorder pushes the transcript here. The audio never leaves the provider's Mac: it is transcribed there and
 * only the text is sent.
 */
export const POST = (req: Request, { params }: { params: { id: string } }) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "notes", level: "edit" });
    const body = await readJson(req);
    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    if (!transcript.trim()) throw new ApiError(400, "empty_transcript");

    const visit = await db.visit.findUnique({ where: { id: params.id } });
    if (!visit) throw new ApiError(404, "not_found");
    await db.visit.update({ where: { id: params.id }, data: { transcript: transcript.slice(0, MAX_TRANSCRIPT) } });
    await audit(user.email, "desktop.notes.transcript", `visit ${params.id} chars=${transcript.length}`);
    return json({ ok: true, visitId: params.id });
  })(req);
