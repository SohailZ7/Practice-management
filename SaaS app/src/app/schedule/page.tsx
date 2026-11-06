import Link from "next/link";
import { db } from "@/lib/db";
import { requireAccess, requireUser } from "@/lib/session";
import { redirect } from "next/navigation";
import { NotesBoard } from "@/components/notes/NotesBoard";
import { visitsForDate } from "@/lib/notes/queries";
import { audit } from "@/lib/audit";
import { canAccess } from "@/lib/access";
import {
  addDays,
  addMonths,
  endOfMonth,
  formatLong,
  formatMonth,
  formatShort,
  isISODate,
  startOfMonth,
  startOfWeek,
  todayISO,
} from "@/lib/dates";
import { entryDTOs } from "@/lib/patients";
import { ScheduleGrid } from "@/components/ScheduleGrid";
import { MonthGrid } from "@/components/MonthGrid";
import type { Prisma } from "@prisma/client";

type View = "day" | "week" | "month";
type Search = { date?: string; view?: string; provider?: string };

export default async function SchedulePage({ searchParams }: { searchParams: Search }) {
  // One Schedule tab: open to anyone with Schedule or Notes access. Visits follow Notes access, entries follow Schedule access.
  const me = await requireUser();
  if (!canAccess(me, "schedule", "view") && !canAccess(me, "notes", "view")) redirect("/denied");
  const user = me;
  const hasSchedule = canAccess(user, "schedule", "view");
  const hasNotes = canAccess(user, "notes", "view");
  const canEdit = canAccess(user, "schedule", "edit");
  const today = todayISO();
  const date = searchParams.date && isISODate(searchParams.date) ? searchParams.date : today;
  const view: View = hasSchedule && (searchParams.view === "week" || searchParams.view === "month") ? searchParams.view : "day";
  // Day view with Notes access lists the visits; schedule rows that belong to a visit are those visits, so only the rest show below.
  const visitsDay = view === "day" && hasNotes;
  const providerFilter = searchParams.provider ?? "";

  // Date range shown by the current view.
  const weekStart = startOfWeek(date);
  let from = date;
  let to = date;
  if (view === "week") {
    from = weekStart;
    to = addDays(weekStart, 6);
  } else if (view === "month") {
    from = startOfWeek(startOfMonth(date));
    to = addDays(startOfWeek(endOfMonth(date)), 6);
  }

  const where: Prisma.ScheduleEntryWhereInput = { date: { gte: from, lte: to } };
  if (providerFilter) where.providerId = providerFilter;
  if (visitsDay) where.visitId = null;

  const [providers, tracks, types, rows] = await Promise.all([
    db.provider.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.trackDef.findMany({ orderBy: { sortOrder: "asc" } }),
    db.entryType.findMany({ orderBy: { name: "asc" } }),
    hasSchedule ? db.scheduleEntry.findMany({ where, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }) : Promise.resolve([]),
  ]);
  const providerName = providers.find((p) => p.id === providerFilter)?.name;
  const visits = visitsDay ? (await visitsForDate(date)).filter((v) => !providerFilter || !providerName || v.providerName === providerName) : [];
  const entries = await entryDTOs(rows);
  // One entry per page load: view, date range, provider filter id and a count. Never client names.
  const providerId = !providerFilter ? "all" : providers.some((p) => p.id === providerFilter) ? providerFilter : "unknown";
  await audit(user.email, "schedule.view", `${view} ${from}..${to} provider=${providerId} entries=${entries.length}`);

  const href = (d: string, v: View = view) => {
    const q = new URLSearchParams({ date: d, view: v });
    if (providerFilter) q.set("provider", providerFilter);
    return `/schedule?${q.toString()}`;
  };
  const prev = view === "month" ? addMonths(date, -1) : addDays(date, view === "week" ? -7 : -1);
  const next = view === "month" ? addMonths(date, 1) : addDays(date, view === "week" ? 7 : 1);
  const title =
    view === "month"
      ? formatMonth(date)
      : view === "week"
        ? `${formatShort(weekStart)} – ${formatShort(addDays(weekStart, 6))}, ${addDays(weekStart, 6).slice(0, 4)}`
        : formatLong(date);

  // Week view: weekdays always; weekend days only when they have entries.
  let days: string[] = [date];
  if (view === "week") {
    days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter(
      (d, i) => i < 5 || entries.some((e) => e.date === d),
    );
  }

  return (
    <>
      <div className="row" style={{ marginBottom: ".75rem" }}>
        <h1 style={{ margin: 0 }}>Schedule</h1>
        <span className="grow" />
        {hasSchedule && <Link href="/schedule/providers">Providers</Link>}
        {hasSchedule && canEdit && <Link href="/schedule/import">Import</Link>}
        {hasSchedule && canEdit && <Link href="/schedule/settings">Tracks &amp; types</Link>}
      </div>

      <div className="row" style={{ marginBottom: "1rem" }}>
        <Link className="btn secondary" href={href(prev)}>
          ←
        </Link>
        <Link className="btn secondary" href={href(today)}>
          Today
        </Link>
        <Link className="btn secondary" href={href(next)}>
          →
        </Link>
        <strong style={{ margin: "0 .5rem" }}>{title}</strong>
        <span className="grow" />
        <div className="seg" role="tablist" aria-label="View">
          {(["day", "week", "month"] as const).map((v) => (
            <Link key={v} href={href(date, v)} className={v === view ? "on" : ""} role="tab" aria-selected={v === view}>
              {v[0].toUpperCase() + v.slice(1)}
            </Link>
          ))}
        </div>
        <form className="row" method="get">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="view" value={view} />
          <select name="provider" defaultValue={providerFilter} aria-label="Filter by provider">
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="secondary">
            Filter
          </button>
        </form>
      </div>

      {visitsDay && (
        <NotesBoard date={date} visits={visits} canEdit={canAccess(user, "notes", "edit")} defaultProvider={process.env.NOTES_DEFAULT_PROVIDER ?? ""} embedded />
      )}

      {visitsDay && entries.length > 0 && <h2 style={{ marginTop: "1.5rem" }}>Other schedule entries (not linked to a visit)</h2>}

      {visitsDay && entries.length === 0 ? null : view === "month" ? (
        <MonthGrid date={date} entries={entries} today={today} dayHref={(d) => href(d, "day")} />
      ) : (
        <ScheduleGrid
          key={`${view}-${from}-${providerFilter}`}
          entries={entries}
          days={days}
          providers={providers}
          tracks={tracks}
          types={types}
          canEdit={canEdit}
          defaultProviderId={providerFilter}
          today={today}
          showMrn={canAccess(user, "billing", "view")}
        />
      )}
    </>
  );
}
