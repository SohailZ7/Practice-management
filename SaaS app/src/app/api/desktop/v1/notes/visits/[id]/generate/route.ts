import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { generateDocuments } from "@/lib/notes/generate";
import { makeLlm, modelConfigured, ModelNotConfiguredError } from "@/lib/notes/model";
import { priorDocument } from "@/lib/notes/queries";

export const dynamic = "force-dynamic";
// Writing a note can take a minute or more.
export const maxDuration = 120;

/**
 * Generates the visit's documents from its stored transcript (same logic as the web board). Documents of a kind the
 * visit already has are left alone so a provider's edits are never overwritten. Returns the visit's primary document.
 */
export const POST = (req: Request, { params }: { params: { id: string } }) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "notes", level: "edit" });
    const visit = await db.visit.findUnique({ where: { id: params.id }, include: { patient: true, documents: true } });
    if (!visit) throw new ApiError(404, "not_found");
    if (!visit.transcript.trim()) throw new ApiError(409, "no_transcript");
    if (!modelConfigured()) throw new ApiError(409, "model_not_configured");

    let docs;
    try {
      const prior = await priorDocument(visit.patientId, visit.visitDate);
      docs = await generateDocuments({
        appointmentType: visit.appointmentType,
        transcript: visit.transcript,
        visitDate: visit.visitDate,
        patientLabel: `${visit.patient.lastName}, ${visit.patient.firstName}`,
        providerName: visit.providerName,
        priorNote: prior,
        llm: makeLlm(),
      });
    } catch (e) {
      if (e instanceof ModelNotConfiguredError) throw new ApiError(409, "model_not_configured");
      throw new ApiError(502, "generate_failed");
    }

    let first: { id: string; label: string; markdown: string } | undefined;
    let made = 0;
    for (const d of docs) {
      const existing = visit.documents.find((e) => e.kind === d.kind);
      let row: { id: string; label: string; markdown: string } | null | undefined = existing;
      if (!existing) {
        row = await db.visitDocument.create({
          data: { visitId: visit.id, kind: d.kind, label: d.label, markdown: d.markdown, draft: true, attention: d.attention.join("\n") },
        });
        made++;
      }
      first ??= row ?? undefined;
    }
    if (!first) throw new ApiError(502, "generate_failed");
    await audit(user.email, "desktop.notes.generate", `visit ${visit.id} documents=${made}`);
    return json({ documentId: first.id, title: first.label, content: first.markdown });
  })(req);
