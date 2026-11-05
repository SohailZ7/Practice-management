// Staging smoke test for template documents, run as a Cloud Run job against the staging database. Uses an invented
// patient and a FAKE transcript only, and removes everything it created. Prints PASS/FAIL lines, never note text.
//   npx tsx scripts/smoke-docs.ts
import { db } from "../src/lib/db";
import { documentPdf, generateDocs, getDocument, listDocuments, saveVersion } from "../src/lib/notes/docService";

const FAKE =
  "Doctor: how have you been since the last visit? Patient: a bit better, sleeping about six hours, appetite is fair. " +
  "Doctor: any thoughts of hurting yourself? Patient: no. Doctor: any side effects from the medicine? Patient: mild " +
  "headache the first week, gone now. Doctor: we will continue the current dose and see you in four weeks.";

const results: string[] = [];
const check = (name: string, ok: boolean, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  return ok;
};

async function main() {
  const admin = await db.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (!admin) throw new Error("no admin user on this database");
  const actor = { id: admin.id, email: admin.email };
  const patient = await db.billingPatient.create({ data: { lastName: "Zzsmoke", firstName: "Synthetic", createdById: admin.id } });
  const visit = await db.visit.create({
    data: { patientId: patient.id, visitDate: "2026-11-05", appointmentType: "Follow-up", providerName: "", transcript: FAKE, createdByEmail: admin.email },
  });
  try {
    const g = await generateDocs(actor, visit.id, ["progress_note"]);
    check("generate progress_note", g.documents.length === 1 && g.documents[0].docType === "progress_note" && !g.errors, g.errors ? JSON.stringify(g.errors) : "");
    const docId = g.documents[0].id;

    const again = await generateDocs(actor, visit.id, ["progress_note"]);
    check("second generate returns the same document", again.documents[0].id === docId);

    const d1 = await getDocument(visit.id, docId);
    check("version 1 exists", d1.versions.map((v) => v.version).join() === "1");
    const textField = d1.fields.find((f) => f.type === "longtext" || f.type === "text");
    if (!textField) throw new Error("template has no text field to edit");

    const s2 = await saveVersion(actor, visit.id, docId, { baseVersion: 1, values: { [textField.name]: "Smoke edit A (fake)" } });
    const s3 = await saveVersion(actor, visit.id, docId, { baseVersion: 2, values: { [textField.name]: "Smoke edit B (fake)" } });
    check("saved versions 2 and 3", s2.version === 2 && s3.version === 3);
    try {
      await saveVersion(actor, visit.id, docId, { baseVersion: 1, values: { [textField.name]: "stale" } });
      check("stale save refused", false);
    } catch (e) {
      check("stale save refused", (e as { code?: string }).code === "stale_version");
    }

    const d3 = await getDocument(visit.id, docId);
    check("versions 1,2,3 listed", d3.versions.map((v) => v.version).join() === "1,2,3");
    const list = await listDocuments(visit.id);
    check("list shows latestVersion 3", list.documents[0]?.latestVersion === 3);

    const pdf = await documentPdf(visit.id, docId, null);
    check("PDF bytes", Buffer.from(pdf.bytes.slice(0, 5)).toString() === "%PDF-", `${pdf.bytes.length} bytes`);
    const pdf1 = await documentPdf(visit.id, docId, "1");
    check("PDF of version 1", pdf1.bytes.length > 1000);
  } finally {
    await db.visit.delete({ where: { id: visit.id } }).catch(() => undefined);
    await db.billingPatient.delete({ where: { id: patient.id } }).catch(() => undefined);
  }
}

main()
  .catch((e) => check("script ran to the end", false, e instanceof Error ? e.message.slice(0, 200) : "error"))
  .finally(async () => {
    console.log(results.join("\n"));
    console.log(results.some((r) => r.startsWith("FAIL")) ? "SMOKE: FAIL" : "SMOKE: PASS");
    await db.$disconnect();
    process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
  });
