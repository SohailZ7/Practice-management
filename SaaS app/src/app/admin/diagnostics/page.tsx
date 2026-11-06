import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { DIAG_RETENTION_DAYS } from "@/lib/desktop/diagnostics";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAdmin();
  const rows = await db.desktopDiagnostic.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { name: true } } } });
  return (
    <>
      <p className="muted">Read only. Event and error code from the Mac recorder, nothing else (no patient or note content). Kept {DIAG_RETENTION_DAYS} days.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>App</th><th>Mac</th><th>Event</th><th>Code</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td>{r.user?.name ?? ""}</td>
                <td>{r.appVersion}</td>
                <td>{r.os}</td>
                <td>{r.event}</td>
                <td>{r.code}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Nothing reported.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
