import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { Banner } from "@/components/Banner";


export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const me = await requireAdmin();
  const log = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });

  await audit(me.email, "audit.view", "recent activity on the Admin console (50 rows)");
  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted">The 50 most recent audit entries. The full, filterable log is under Access review.</p>
      <h2>Recent activity</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <tr key={l.id}>
                <td className="small">{l.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{l.actorEmail}</td>
                <td>{l.action}</td>
                <td className="small muted">{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
