import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { DIAG_RETENTION_DAYS, type DiagEvent } from "@/lib/desktop/diagnostics";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: { user?: string } }) {
  await requireAdmin();
  const users = await db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const userId = users.some((u) => u.id === searchParams.user) ? searchParams.user : undefined;
  const rows = await db.desktopDiagnostic.findMany({ where: userId ? { userId } : {}, orderBy: { receivedAt: "desc" }, take: 50, include: { user: { select: { name: true } } } });
  return (
    <>
      <p className="muted">Read only. Versions, error codes and short scrubbed notes from the Mac recorder; no patient or note content. Last 50 reports, kept {DIAG_RETENTION_DAYS} days.</p>
      <form method="get" className="row">
        <label>Person{" "}
          <select name="user" defaultValue={userId ?? ""}>
            <option value="">Everyone</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <button type="submit" className="secondary">Filter</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Received</th><th>Who</th><th>App</th><th>Env</th><th>Mac</th><th>Sent by</th><th>Events</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.receivedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td>{r.user?.name ?? ""}</td>
                <td>{r.appVersion}{r.commit ? ` (${r.commit.slice(0, 7)})` : ""}</td>
                <td>{r.environment}</td>
                <td>{r.os} {r.arch}</td>
                <td>{r.manual ? "person" : "automatic"}</td>
                <td>{(r.events as unknown as DiagEvent[]).map((e, i) => <div key={i}>{e.kind}{e.code ? ` ${e.code}` : ""}{e.route ? ` ${e.route}` : ""}{e.detail ? ` – ${e.detail}` : ""}</div>)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Nothing reported.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
