// End to end against the real database and the real local model. Skipped unless NOTES_E2E=1.
//   NOTES_E2E=1 npx vitest run tests/notesPipeline.integration.test.ts
// Uses invented patients only.
import { describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { generateDocuments } from "../src/lib/notes/generate";
import { makeLlm } from "../src/lib/notes/model";
import { isDraft } from "../src/lib/notes/markdown";
import { markdownToHtml } from "../src/lib/notes/pdf";
import { priorDocument } from "../src/lib/notes/queries";

const TRANSCRIPT =
  "Doctor: how have the last two weeks been? Patient: better, the nausea went away after the first week and I am " +
  "sleeping about seven hours now. I still have low energy in the afternoons. Doctor: any thoughts of hurting " +
  "yourself? Patient: no, none. Doctor: any missed doses? Patient: I missed two doses last week. My husband thinks " +
  "I should stop the medicine, but I want to keep taking it. Doctor: I will continue the sertraline at one hundred " +
  "milligrams. See you in four weeks.";

describe.skipIf(process.env.NOTES_E2E !== "1")("notes pipeline", () => {
  it("writes, stores, reads back and renders a visit's documents", async () => {
    const admin = await db.user.findFirst({ where: { role: "ADMIN" } });
    expect(admin, "seed the database first").toBeTruthy();

    const patient = await db.billingPatient.create({
      data: { lastName: "Zzsynthetic", firstName: "Testcase", createdById: admin!.id },
    });
    const visit = await db.visit.create({
      data: {
        patientId: patient.id,
        visitDate: "2026-11-01",
        appointmentType: "Follow-up",
        program: "BPHP-AM",
        providerName: "Dr. Example",
        transcript: TRANSCRIPT,
        createdByEmail: admin!.email,
      },
    });

    try {
      const started = Date.now();
      const docs = await generateDocuments({
        appointmentType: visit.appointmentType,
        transcript: visit.transcript,
        visitDate: visit.visitDate,
        patientLabel: "Zzsynthetic, Testcase",
        providerName: visit.providerName,
        priorNote: await priorDocument(patient.id, visit.visitDate),
        llm: makeLlm(),
      });
      console.log(`  generated ${docs.length} documents in ${Math.round((Date.now() - started) / 1000)}s`);

      // A Follow-up produces the Fairfax form plus the narrative note.
      expect(docs.map((d) => d.label)).toEqual(["Progress Note", "Follow-up"]);

      for (const d of docs) {
        await db.visitDocument.create({
          data: { visitId: visit.id, kind: d.kind, label: d.label, markdown: d.markdown, draft: true, attention: d.attention.join("\n") },
        });
        expect(isDraft(d.markdown), `${d.label} should be a draft`).toBe(true);
        expect(d.markdown).toContain("## Needs your attention");
        // The patient's name is written into the header by us, never by the model.
        expect(d.markdown).toContain("**Patient:** Zzsynthetic, Testcase");
        const html = markdownToHtml(d.markdown);
        expect(html).toContain("<h1>");
        console.log(`  --- ${d.label}: ${d.markdown.length} chars, ${d.attention.length} flagged`);
        if (process.env.NOTES_DUMP) console.log(d.markdown.split("\n").map((l) => `      ${l}`).join("\n"));
      }

      // Reads back through the encrypted column exactly as written.
      const stored = await db.visitDocument.findMany({ where: { visitId: visit.id } });
      expect(stored).toHaveLength(2);
      expect(stored.find((s) => s.label === "Follow-up")!.markdown).toBe(docs.find((d) => d.label === "Follow-up")!.markdown);
    } finally {
      await db.visitDocument.deleteMany({ where: { visitId: visit.id } });
      await db.visit.delete({ where: { id: visit.id } });
      await db.billingPatient.delete({ where: { id: patient.id } });
    }
  }, 1_200_000);
});
