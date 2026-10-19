import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { userNames } from "@/lib/billing/queries";

const LABELS: Record<string, string> = {
  encounterDate: "Date",
  programId: "Program",
  icd10Codes: "ICD-10",
  chargeCode: "Charge code",
  note: "Note",
  getixEntered: "In GetIX",
  deletedAt: "Deleted at",
  mrn: "MRN",
  lastName: "Last name",
  firstName: "First name",
  mergedIntoId: "Merged into",
};

function show(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

// Admin only (BIL-13). Opening it is audit-logged; the log holds ids, never patient data.
export default async function HistoryPage({ searchParams }: { searchParams: { entity?: string; id?: string } }) {
  const admin = await requireAdmin();
  const entity = searchParams.entity === "patient" ? "patient" : searchParams.entity === "encounter" ? "encounter" : null;
  const id = searchParams.id;
  if (!entity || !id) notFound();

  const [rows, programs] = await Promise.all([
    db.billingHistory.findMany({ where: { entity, entityId: id }, orderBy: { changedAt: "desc" } }),
    db.program.findMany({ select: { id: true, name: true } }),
  ]);
  const names = await userNames(rows.map((r) => r.changedById));
  const programName = new Map(programs.map((p) => [p.id, p.name]));
  await audit(admin.email, "billing.history.view", `${entity} ${id}`);

  let back = "/billing";
  if (entity === "patient") back = `/billing/patients/${id}`;
  else {
    const enc = await db.encounter.findUnique({ where: { id }, select: { patientId: true } });
    if (enc) back = `/billing/patients/${enc.patientId}`;
  }

  return (
    <>
      <p>
        <Link href={back}>← Back</Link>
      </p>
      <h2 style={{ marginTop: 0 }}>Edit history</h2>
      <p className="muted">Each entry is the version <em>before</em> the change.</p>
      {rows.length === 0 && <div className="card muted">No changes have been made to this record.</div>}
      {rows.map((r) => {
        const snap = r.snapshot as Record<string, unknown>;
        const keys = Object.keys(LABELS).filter((k) => k in snap);
        return (
          <div key={r.id} className="card">
            <div className="row">
              <strong>{r.action.replace(/_/g, " ")}</strong>
              <span className="muted small">
                {r.changedAt.toISOString().replace("T", " ").slice(0, 19)} by {names.get(r.changedById) ?? "unknown"}
              </span>
            </div>
            <dl className="kv">
              {keys.map((k) => (
                <div key={k}>
                  <dt>{LABELS[k]}</dt>
                  <dd>{k === "programId" ? (programName.get(String(snap[k])) ?? show(snap[k])) : show(snap[k])}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </>
  );
}
