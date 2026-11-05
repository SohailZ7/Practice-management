import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Banner } from "@/components/Banner";
import { isStaging, whyNotPromotable } from "@/lib/promote/rules";
import { promote, toggleTest } from "./actions";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

type Row = { id: string; title: string; sub: string; isTest: boolean; promotedAt: Date | null; blocked: string | null };

const BLOCK_LABEL: Record<string, string> = { recurring: "Recurring, can't promote", synced: "Synced from Todo App, can't promote" };

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  if (!isStaging()) notFound(); // the page does not exist in production
  const [tasks, feedback] = await Promise.all([
    db.task.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { assignee: true } }),
    db.feedbackItem.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { author: true } }),
  ]);
  const taskRows: Row[] = tasks.map((t) => ({ id: t.id, title: t.title, sub: `${t.assignee?.name ?? "Unassigned"}${t.completed ? " · done" : ""}`, isTest: t.isTest, promotedAt: t.promotedAt, blocked: whyNotPromotable("task", t) }));
  const fbRows: Row[] = feedback.map((f) => ({ id: f.id, title: f.title, sub: `${f.kind === "BUG" ? "Bug" : "Feedback"} · ${f.author.name} · ${when(f.createdAt)}`, isTest: f.isTest, promotedAt: f.promotedAt, blocked: whyNotPromotable("feedback", f) }));

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <h2>Promote to production</h2>
      <p className="muted small">
        Staging only. Copies tasks and feedback to production; never patient data. Items marked as test are never sent, and an item already promoted is not sent twice.
      </p>
      <Section title="Tasks" kind="task" rows={taskRows} />
      <Section title="Feedback" kind="feedback" rows={fbRows} />
    </>
  );
}

function Section({ title, kind, rows }: { title: string; kind: "task" | "feedback"; rows: Row[] }) {
  const formId = `bulk-${kind}`;
  return (
    <div className="card">
      <div className="row">
        <strong className="grow">{title}</strong>
        <form id={formId} action={promote}>
          <input type="hidden" name="kind" value={kind} />
          <button type="submit">Promote selected</button>
        </form>
      </div>
      {rows.length === 0 && <p className="muted">Nothing here.</p>}
      {rows.map((r) => {
        const canPromote = !r.blocked;
        return (
          <div key={r.id} className="row" style={{ alignItems: "center", gap: ".5rem", padding: ".25rem 0" }}>
            <input type="checkbox" form={formId} name="id" value={r.id} disabled={!canPromote} aria-label={`Select ${r.title}`} />
            <div className="grow">
              <div>{r.title}</div>
              <div className="muted small">{r.sub}</div>
            </div>
            {r.promotedAt && <span className="muted small" title="Already copied to production">Promoted {when(r.promotedAt)}</span>}
            {r.blocked && r.blocked !== "already_promoted" && r.blocked !== "test_item" && <span className="muted small">{BLOCK_LABEL[r.blocked]}</span>}
            {r.isTest && <span className="muted small">Test item</span>}
            {canPromote && (
              <form action={promote}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={r.id} />
                <button type="submit">Promote</button>
              </form>
            )}
            {!r.promotedAt && (
              <form action={toggleTest}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="isTest" value={r.isTest ? "false" : "true"} />
                <button type="submit" className="small">{r.isTest ? "Not a test" : "Mark test"}</button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
