import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { db } from "@/lib/db";
import { ImportWizard } from "@/components/ImportWizard";

export default async function ImportPage() {
  await requireAccess("schedule", "edit");
  const logs = await db.importLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <>
      <p>
        <Link href="/schedule">← Schedule</Link>
      </p>
      <h1>Import schedule from Excel</h1>
      <p className="muted">
        Upload a workbook laid out like the Outpatient Board (a providers table, then day blocks with Psych
        Eval and Track rows). Nothing is saved until you confirm the preview. Re-importing the same sheet
        will not create duplicates.
      </p>
      <ImportWizard />
      <h2>Recent imports</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th>Sheet</th>
              <th>By</th>
              <th>New</th>
              <th>Duplicates</th>
              <th>Skipped</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No imports yet.
                </td>
              </tr>
            )}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="small">{l.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                <td>{l.fileName}</td>
                <td>{l.sheet}</td>
                <td>{l.userEmail}</td>
                <td>{l.created}</td>
                <td>{l.duplicates}</td>
                <td>{l.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
