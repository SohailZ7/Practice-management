import Link from "next/link";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { MODULES } from "@/lib/access";
import {
  AUDIT_PAGE_SIZE,
  auditQuery,
  auditWhere,
  buildReviewRows,
  describeFilters,
  pageCount,
  parseAuditFilters,
  summarize,
} from "@/lib/accessReview";

type Search = Record<string, string | string[] | undefined>;

// Admin only. Quarterly use is recommended (see docs/hipaa-readiness.md). Opening this page, the log viewer and
// either export is itself written to the audit log.
export default async function AccessReviewPage({ searchParams }: { searchParams: Search }) {
  const admin = await requireAdmin();
  const filters = parseAuditFilters(searchParams);
  const where = auditWhere(filters);
  const now = new Date();

  const [users, employees, viewers, total, actions] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { access: true } }),
    db.employee.findMany({ select: { id: true, name: true } }),
    db.taskViewer.findMany({ select: { userId: true, employeeId: true } }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
  ]);
  const pages = pageCount(total);
  const page = Math.min(filters.page, pages);
  const log = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE });

  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const rows = buildReviewRows(
    users,
    viewers.map((v) => ({ userId: v.userId, employeeName: empName.get(v.employeeId) ?? "unknown" })),
    now,
  );
  const sum = summarize(rows);

  await audit(admin.email, "access_review.view", `${sum.total} users, ${sum.admins} admins, ${sum.stale} flagged stale`);
  await audit(admin.email, "audit.view", `${describeFilters(filters)}; page ${page} of ${pages}; ${log.length} row(s)`);

  const qs = (p: number) => `/admin/access-review?${auditQuery(filters, p)}`;
  const exportQs = auditQuery({ ...filters, page: 1 });

  return (
    <>
      <p>
        <Link href="/admin">← Access</Link>
      </p>
      <h1>Access review</h1>
      <p className="muted">
        Review who can sign in and what they can open. A <strong>quarterly review</strong> is recommended: confirm every
        person is still on the team, remove access that is no longer needed, and check the admin count. Record the date you
        reviewed in your security log.
      </p>

      <div className="card row">
        <span>
          <strong>{sum.active}</strong> active of {sum.total} users
        </span>
        <span className={sum.admins > 2 ? "pill warn" : "pill"}>
          {sum.admins} admin{sum.admins === 1 ? "" : "s"}
        </span>
        <span className={sum.stale ? "pill warn" : "pill ok"}>{sum.stale} with no sign-in in 90 days</span>
        <span className="grow" />
        <a className="btn secondary" href="/admin/access-review/users.csv">
          Export users (CSV)
        </a>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Active</th>
              <th>Last sign-in</th>
              {MODULES.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>Can view tasks of</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email}>
                <td>
                  {r.name}
                  <div className="small muted">{r.email}</div>
                </td>
                <td>{r.role}</td>
                <td>{r.active ? "yes" : "no"}</td>
                <td className="small">{r.lastLogin}</td>
                {MODULES.map((m) => (
                  <td key={m}>{r.levels[m]}</td>
                ))}
                <td className="small">{r.taskViewers.join(", ") || "—"}</td>
                <td>
                  {r.flags.map((f) => (
                    <span key={f} className={f === "admin" ? "pill" : "pill warn"} style={{ marginRight: 4 }}>
                      {f}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Audit log</h2>
      <form className="card row" method="get">
        <input name="user" placeholder="User email contains…" defaultValue={filters.user} aria-label="User" />
        <input name="action" placeholder="Action starts with… e.g. billing." defaultValue={filters.action} list="audit-actions" aria-label="Action" />
        <datalist id="audit-actions">
          {actions.map((a) => (
            <option key={a.action} value={a.action} />
          ))}
        </datalist>
        <label className="check">
          From <input type="date" name="from" defaultValue={filters.from} />
        </label>
        <label className="check">
          To <input type="date" name="to" defaultValue={filters.to} />
        </label>
        <button type="submit" className="secondary">
          Filter
        </button>
        <Link href="/admin/access-review">Clear</Link>
        <span className="grow" />
        <a className="btn secondary" href={`/admin/access-review/audit.csv${exportQs ? `?${exportQs}` : ""}`}>
          Export (CSV)
        </a>
      </form>
      <p className="muted small">
        {total.toLocaleString()} entr{total === 1 ? "y" : "ies"}. Dates are UTC days. The log records who did what to which
        record (ids and counts), never patient names or notes. It is append-only in the database.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When (UTC)</th>
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
            {log.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No entries match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: ".75rem" }}>
        {page > 1 ? <Link className="btn secondary" href={qs(page - 1)}>← Newer</Link> : <span />}
        <span className="muted small">
          Page {page} of {pages}
        </span>
        {page < pages ? <Link className="btn secondary" href={qs(page + 1)}>Older →</Link> : <span />}
      </div>
    </>
  );
}
