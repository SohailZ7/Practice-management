import { authenticate, handle, json, readJson, ApiError } from "@/lib/desktop/api";
import { makeLlm, ModelNotConfiguredError } from "@/lib/notes/model";
import { CLEANUP_SYSTEM, MAX_TRANSCRIPT, cleanupPrompt, parseCleanup } from "@/lib/feedback/rules";
import { detectPhi } from "@/lib/phiGuard";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Turns a dictated transcript (text only, no audio) into a title and description for review. The transcript may contain
 * patient information, so nothing about it is logged: not the text, not the model's reply, not an error message. The
 * result is not saved here; the recorder shows it for review and saves through POST /api/desktop/v1/feedback.
 */
export const POST = handle(async (req) => {
  await authenticate(req);
  const body = await readJson(req);
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) throw new ApiError(400, "transcript_required");
  if (transcript.length > MAX_TRANSCRIPT) throw new ApiError(413, "transcript_too_long");

  let reply: string;
  try {
    reply = await makeLlm()({ system: CLEANUP_SYSTEM, prompt: cleanupPrompt(transcript) });
  } catch (e) {
    if (e instanceof ModelNotConfiguredError) throw new ApiError(503, "model_not_configured");
    throw new ApiError(502, "model_unavailable");
  }
  const out = parseCleanup(reply);
  if (!out) throw new ApiError(502, "model_unusable_reply");
  // Tell the recorder if the cleaned text still looks like it holds patient information, so the user can edit it out.
  const phi = Array.from(new Set(detectPhi(`${out.title}\n${out.description}`).map((f) => f.kind)));
  return json({ title: out.title, description: out.description, possiblePhi: phi });
});
