import { audit } from "@/lib/audit";
import { json } from "@/lib/desktop/api";
import { ApiError } from "@/lib/desktop/api";
import { trainingExportResponse } from "@/lib/notes/docRoutes";
import { webAdminAuth } from "@/lib/notes/webAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Admin only. Returns JSONL of model output vs. clinician edits for template documents. The file contains PHI
 * (transcripts and clinical values): see trainingRecords() in docService.ts before using it for anything.
 */
export async function GET() {
  try {
    const admin = await webAdminAuth();
    await audit(admin.email, "notes.training.export", "jsonl");
    return await trainingExportResponse();
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.code }, e.status);
    console.error("training export error");
    return json({ error: "server_error" }, 500);
  }
}
