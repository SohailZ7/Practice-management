import Link from "next/link";
import { requireUser, levels } from "@/lib/session";
import { canAccess, canOpenAdmin } from "@/lib/access";
import { db } from "@/lib/db";
import { PRACTICE_TIMEZONE, todayISO } from "@/lib/dates";
import { ensureRecurringTasks } from "@/lib/recurring";
import { visitsForDate, type VisitRow } from "@/lib/notes/queries";
import { Phi } from "@/components/Phi";
import { statusLabel, statusTone } from "@/lib/notes/visitStatus";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: PRACTICE_TIMEZONE }).format(new Date())) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const longDate = () => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: PRACTICE_TIMEZONE }).format(new Date());
const docState = (v: VisitRow) =>
  v.status === "cancelled" ? { label: "None", tone: "grey" } : v.documents.length === 0 ? { label: "Not started", tone: "grey" } : v.documents.some((d) => d.draft) ? { label: "Needs review", tone: "amber" } : { label: "Ready", tone: "green" };

export default async function Home() {
  const user = await requireUser();
  const lv = levels(user);
  const today = todayISO();
  await ensureRecurringTasks();
  const first = user.name.split(/\s+/)[0] || user.name;

  const showVisits = lv.schedule !== "none";
  const showBilling = canAccess(user, "billing", "view");
  const [visits, tasks, openCount, waitingBilling] = await Promise.all([
    showVisits ? visitsForDate(today).catch(() => [] as VisitRow[]) : Promise.resolve([] as VisitRow[]),
    lv.tasks !== "none"
      ? db.task.findMany({
          where: { completed: false, assignee: { email: user.email }, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] },
          orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
          take: 3,
          select: { id: true, title: true, dueDate: true },
        })
      : Promise.resolve([]),
    lv.tasks !== "none"
      ? db.task.count({ where: { completed: false, assignee: { email: user.email }, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] } })
      : Promise.resolve(0),
    showBilling ? db.encounter.count({ where: { deletedAt: null, getixEntered: false } }) : Promise.resolve(0),
  ]);

  const live = visits.filter((v) => v.status !== "cancelled");
  const complete = live.filter((v) => v.status === "seen" || v.status === "note_signed").length;
  const remaining = live.filter((v) => v.status === "scheduled").length;
  const toReview = visits.filter((v) => v.documents.some((d) => d.draft)).length;
  const notStarted = visits.filter((v) => v.status !== "cancelled" && v.documents.length === 0 && (v.status === "seen" || v.status === "note_signed")).length;
  const noShows = visits.filter((v) => v.status === "no_show").length;
  const next = visits.find((v) => v.status === "scheduled");

  const stats = [
    ...(showVisits ? [
      { label: "Visits today", value: live.length, note: `${complete} complete · ${remaining} remaining`, dot: "plum", href: "/schedule" },
      { label: "Documents to review", value: toReview, note: "Drafts waiting for a look", dot: "amber", href: "/schedule" },
    ] : []),
    ...(lv.tasks !== "none" ? [{ label: "Your open tasks", value: openCount, note: "Assigned to you", dot: "blue", href: "/tasks" }] : []),
    ...(showBilling ? [{ label: "Waiting for GetIX", value: waitingBilling, note: "Entered by hand, one at a time", dot: "green", href: "/billing" }] : []),
  ];
  const attn = [
    ...(toReview ? [{ title: `${toReview} document${toReview === 1 ? "" : "s"} need a review`, note: "Complete the record. Keep care moving.", tone: "amber" }] : []),
    ...(notStarted ? [{ title: `${notStarted} seen visit${notStarted === 1 ? "" : "s"} with no document yet`, note: "Start the note from the Schedule.", tone: "rose" }] : []),
    ...(noShows ? [{ title: `${noShows} no-show${noShows === 1 ? "" : "s"} today`, note: "Check follow-up is arranged.", tone: "blue" }] : []),
  ];
  const modules = [
    lv.employees !== "none" && { href: "/employees", title: "Employees", note: "Directory" },
    showBilling && { href: "/billing", title: "Billing", note: "Encounters and GetIX" },
    lv.ledger !== "none" && { href: "/ledger", title: "Ledger", note: "Business cash in and out" },
    canOpenAdmin(user) && { href: "/admin", title: "Access", note: "Users and module access" },
  ].filter(Boolean) as { href: string; title: string; note: string }[];
  const shown = visits.slice(0, 6);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-eyebrow">{longDate()}</p>
          <h1>{greeting()}, {first}.</h1>
          <p className="muted">Your day, and anything that could slow it down.</p>
        </div>
        {lv.schedule !== "none" && <Link className="btn secondary" href="/schedule">View schedule</Link>}
      </div>

      {showVisits && (
        <section className="hero" aria-label="Your practice, in focus">
          <div className="hero-main">
            <p className="hero-eyebrow">Your practice, in focus</p>
            <h2>Make room for a smoother day.</h2>
            <p className="hero-text">
              {live.length} visit{live.length === 1 ? "" : "s"} today, {complete} complete, and {toReview} document{toReview === 1 ? "" : "s"} could use your attention. Every recording is safe on the recording computer until it reaches the server.
            </p>
            {toReview > 0 && <Link className="hero-btn" href="/schedule">Review what needs attention</Link>}
          </div>
          <div className="hero-side">
            <p className="hero-eyebrow">{next ? "Next up" : "Today"}</p>
            {next ? (
              <>
                <div className="hero-time">{next.apptTime || "Time not set"}</div>
                <div>{next.appointmentType} · {next.providerName}</div>
                <div className="hero-who"><span className="hero-dot" />{next.fullName ? <Phi name={next.fullName} /> : next.initials}</div>
              </>
            ) : (
              <div className="hero-time">{live.length === 0 ? "No visits" : "All done"}</div>
            )}
          </div>
        </section>
      )}

      {stats.length > 0 && (
        <section className="ov-stats" aria-label="Today at a glance" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}>
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="ov-stat">
              <span className="ov-stat-top"><span>{s.label}</span><span className={`stage-dot ${s.dot}`} aria-hidden="true" /></span>
              <span className="ov-stat-n">{s.value}</span>
              <span className="ov-stat-note">{s.note}</span>
            </Link>
          ))}
        </section>
      )}

      <div className="ov-grid">
        {showVisits && (
          <section className="sched-card" aria-label="Today's schedule">
            <div className="ov-card-head">
              <div>
                <h2>Today&apos;s schedule <span className="count-chip">{visits.length}</span></h2>
                <p className="muted small">{longDate().replace(/, \d{4}$/, "")} · All providers</p>
              </div>
              <Link href="/schedule" className="link-strong">Open schedule</Link>
            </div>
            <div className="table-flush">
              <table className="visits">
                <thead>
                  <tr><th>Time</th><th>Patient</th><th>Visit</th><th>Status</th><th>Documents</th></tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={5} className="muted">No visits today.</td></tr>
                  )}
                  {shown.map((v) => {
                    const d = docState(v);
                    return (
                      <tr key={v.id}>
                        <td className="num"><strong>{v.apptTime || "—"}</strong></td>
                        <td>
                          <span className="pat-cell">
                            <span className="avatar sm" aria-hidden="true">{v.initials.slice(0, 2)}</span>
                            <span><strong>{v.fullName ? <Phi name={v.fullName} /> : v.initials}</strong><span className="sub">{v.program}</span></span>
                          </span>
                        </td>
                        <td>{v.appointmentType}<span className="sub">{v.providerName}</span></td>
                        <td><span className={`status-pill tone-${statusTone(v.status)}`}>{statusLabel(v.status)}</span></td>
                        <td><span className={`mini-pill ${d.tone}`}>{d.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sched-foot"><span>Showing {shown.length} of {visits.length} visits today</span><span>Open the Schedule for the full day</span></div>
          </section>
        )}

        <aside className="ov-side">
          <section className="ov-panel">
            <h2>Needs attention</h2>
            {attn.length === 0 && <p className="muted small">Nothing needs attention right now.</p>}
            {attn.map((a) => (
              <div key={a.title} className="attn-row">
                <span className={`attn-ico ${a.tone}`} aria-hidden="true" />
                <div><strong>{a.title}</strong><span className="sub">{a.note}</span></div>
              </div>
            ))}
          </section>
          {lv.tasks !== "none" && (
            <section className="ov-panel">
              <div className="ov-panel-head"><h2>Your focus</h2><Link href="/tasks" className="link-strong">All tasks</Link></div>
              {tasks.length === 0 && <p className="muted small">No open tasks assigned to you.</p>}
              {tasks.map((t) => (
                <Link key={t.id} href="/tasks" className="focus-row">
                  <span className="focus-box" aria-hidden="true" />
                  <span>{t.title}<span className="sub">{t.dueDate ? `Due ${t.dueDate}` : "No due date"}</span></span>
                </Link>
              ))}
            </section>
          )}
          {modules.length > 0 && (
            <section className="ov-panel">
              <h2>Go to</h2>
              {modules.map((m) => (
                <Link key={m.href} href={m.href} className="focus-row"><span><strong>{m.title}</strong><span className="sub">{m.note}</span></span></Link>
              ))}
            </section>
          )}
          <p className="ov-quote">Good systems make space for good care.</p>
        </aside>
      </div>
    </>
  );
}
