import Link from "next/link";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { addDays, formatLong, isISODate, startOfWeek, todayISO } from "@/lib/dates";
import { Banner } from "@/components/Banner";
import { addEntry, deleteEntry, saveEntry } from "./actions";
import type { Prisma, ScheduleEntry } from "@prisma/client";

type Search = { date?: string; view?: string; provider?: string; error?: string; notice?: string };

function statusClass(e: ScheduleEntry) {
  if (e.canceled) return "status-canceled";
  if (e.missed) return "status-missed";
  if (e.absent) return "status-absent";
  if (e.completed) return "status-completed";
  return "";
}

function totals(entries: ScheduleEntry[]) {
  return {
    scheduled: entries.length,
    completed: entries.filter((e) => e.completed).length,
    absent: entries.filter((e) => e.absent).length,
    canceled: entries.filter((e) => e.canceled).length,
    missed: entries.filter((e) => e.missed).length,
  };
}

export default async function SchedulePage({ searchParams }: { searchParams: Search }) {
  const user = await requireAccess("schedule", "view");
  const canEdit = canAccess(user, "schedule", "edit");
  const date = searchParams.date && isISODate(searchParams.date) ? searchParams.date : todayISO();
  const view = searchParams.view === "week" ? "week" : "day";
  const providerFilter = searchParams.provider ?? "";

  const [providers, tracks, types] = await Promise.all([
    db.provider.findMany({ orderBy: { name: "asc" } }),
    db.trackDef.findMany({ orderBy: { sortOrder: "asc" } }),
    db.entryType.findMany({ orderBy: { name: "asc" } }),
  ]);

  const weekStart = startOfWeek(date);
  const range = view === "week" ? { gte: weekStart, lte: addDays(weekStart, 6) } : { equals: date };
  const where: Prisma.ScheduleEntryWhereInput = { date: range };
  if (providerFilter) where.providerId = providerFilter;
  const entries = await db.scheduleEntry.findMany({
    where,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  const qs = (d: string, v = view) => {
    const q = new URLSearchParams({ date: d, view: v });
    if (providerFilter) q.set("provider", providerFilter);
    return `/schedule?${q.toString()}`;
  };
  const step = view === "week" ? 7 : 1;

  return (
    <>
      <h1>Schedule</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />

      <div className="row" style={{ marginBottom: "1rem" }}>
        <Link className="btn secondary" href={qs(addDays(date, -step))}>
          ← Prev
        </Link>
        <Link className="btn secondary" href={qs(todayISO())}>
          Today
        </Link>
        <Link className="btn secondary" href={qs(addDays(date, step))}>
          Next →
        </Link>
        <Link className={view === "day" ? "btn" : "btn secondary"} href={qs(date, "day")}>
          Day
        </Link>
        <Link className={view === "week" ? "btn" : "btn secondary"} href={qs(date, "week")}>
          Week
        </Link>
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
        <span className="grow" />
        <Link href="/schedule/providers">Providers</Link>
        {canEdit && <Link href="/schedule/import">Import</Link>}
        {canEdit && <Link href="/schedule/settings">Tracks &amp; types</Link>}
      </div>

      {view === "week" ? (
        <WeekView weekStart={weekStart} entries={entries} qs={qs} />
      ) : (
        <DayView
          date={date}
          entries={entries}
          canEdit={canEdit}
          providers={providers}
          providerFilter={providerFilter}
          tracks={tracks}
          types={types}
        />
      )}
    </>
  );
}

function WeekView({
  weekStart,
  entries,
  qs,
}: {
  weekStart: string;
  entries: ScheduleEntry[];
  qs: (d: string, v?: "day" | "week") => string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Scheduled</th>
            <th>Completed</th>
            <th>Absent</th>
            <th>Canceled</th>
            <th>Missed</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const t = totals(entries.filter((e) => e.date === d));
            return (
              <tr key={d}>
                <td>
                  <Link href={qs(d, "day")}>{formatLong(d)}</Link>
                </td>
                <td>{t.scheduled}</td>
                <td>{t.completed}</td>
                <td>{t.absent}</td>
                <td>{t.canceled}</td>
                <td>{t.missed}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Opt = { id: string; name: string };

function DayView({
  date,
  entries,
  canEdit,
  providers,
  providerFilter,
  tracks,
  types,
}: {
  date: string;
  entries: ScheduleEntry[];
  canEdit: boolean;
  providers: Opt[];
  providerFilter: string;
  tracks: { id: string; name: string; startTime: string; endTime: string }[];
  types: Opt[];
}) {
  const t = totals(entries);
  return (
    <>
      <div className="card">
        <strong>{formatLong(date)}</strong>
        <span className="muted">
          {" "}
          · {t.scheduled} scheduled · {t.completed} completed · {t.absent} absent · {t.canceled} canceled ·{" "}
          {t.missed} missed
        </span>
      </div>
      <datalist id="type-options">
        {types.map((x) => (
          <option key={x.id} value={x.name} />
        ))}
      </datalist>
      <datalist id="track-options">
        {tracks.map((x) => (
          <option key={x.id} value={`${x.name}   ${x.startTime} - ${x.endTime}`} />
        ))}
      </datalist>
      {(["PSYCH_EVAL", "TRACK"] as const).map((section) => (
        <Section
          key={section}
          section={section}
          date={date}
          entries={entries.filter((e) => e.section === section)}
          canEdit={canEdit}
          providers={providers}
          providerFilter={providerFilter}
        />
      ))}
    </>
  );
}

function Section({
  section,
  date,
  entries,
  canEdit,
  providers,
  providerFilter,
}: {
  section: "PSYCH_EVAL" | "TRACK";
  date: string;
  entries: ScheduleEntry[];
  canEdit: boolean;
  providers: Opt[];
  providerFilter: string;
}) {
  const title = section === "PSYCH_EVAL" ? "Psych Eval" : "Tracks";
  const timeList = section === "TRACK" ? "track-options" : undefined;
  return (
    <section className="board-section">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{section === "TRACK" ? "Track" : "Time"}</th>
              <th>Type</th>
              <th>Client info</th>
              <th>Provider</th>
              <th>Status</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing scheduled.
                </td>
              </tr>
            )}
            {entries.map((e) =>
              canEdit ? (
                <tr key={e.id} className={`entry-row ${statusClass(e)}`}>
                  <td colSpan={6}>
                    <form action={saveEntry} className="row">
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="date" value={date} />
                      <input type="hidden" name="filterProvider" value={providerFilter} />
                      <input type="hidden" name="providerName" value={e.providerName} />
                      <input name="timeLabel" defaultValue={e.timeLabel} list={timeList} style={{ width: 200 }} />
                      <input name="typeName" defaultValue={e.typeName} list="type-options" style={{ width: 170 }} />
                      <input name="clientInfo" defaultValue={e.clientInfo} className="grow" required />
                      <select name="providerId" defaultValue={e.providerId ?? ""}>
                        <option value="">{e.providerName ? `(${e.providerName})` : "No provider"}</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {(["absent", "canceled", "completed", "missed"] as const).map((f) => (
                        <label key={f} className="check">
                          <input type="checkbox" name={f} defaultChecked={e[f]} /> {f}
                        </label>
                      ))}
                      <button type="submit">Save</button>
                      <button type="submit" formAction={deleteEntry} className="danger">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={e.id} className={statusClass(e)}>
                  <td>{e.timeLabel}</td>
                  <td>{e.typeName}</td>
                  <td>{e.clientInfo}</td>
                  <td>{e.providerName}</td>
                  <td>
                    {(["absent", "canceled", "completed", "missed"] as const)
                      .filter((f) => e[f])
                      .join(", ")}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <form action={addEntry} className="card row" style={{ marginTop: ".5rem" }}>
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="section" value={section} />
          <input type="hidden" name="filterProvider" value={providerFilter} />
          <input
            name="timeLabel"
            placeholder={section === "TRACK" ? "Track" : "Time, e.g. Psych Eval 9:00"}
            list={timeList}
            style={{ width: 220 }}
          />
          <input name="typeName" placeholder="Type" list="type-options" style={{ width: 170 }} />
          <input name="clientInfo" placeholder="Client info" required className="grow" />
          <select name="providerId" defaultValue="">
            <option value="">No provider</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit">Add</button>
        </form>
      )}
    </section>
  );
}
