import Link from "next/link";
import { monthWeeks } from "@/lib/dates";
import { totals, type EntryDTO } from "@/lib/scheduleTypes";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthGrid({
  date,
  entries,
  today,
  dayHref,
}: {
  date: string;
  entries: EntryDTO[];
  today: string;
  dayHref: (iso: string) => string;
}) {
  const month = date.slice(0, 7);
  const byDay = new Map<string, EntryDTO[]>();
  for (const e of entries) {
    const list = byDay.get(e.date) ?? [];
    list.push(e);
    byDay.set(e.date, list);
  }

  return (
    <div className="month">
      <div className="month-head">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      {monthWeeks(date).map((week) => (
        <div className="month-week" key={week[0]}>
          {week.map((day) => {
            const list = byDay.get(day) ?? [];
            const t = totals(list);
            const perProvider = new Map<string, number>();
            for (const e of list) {
              const name = e.providerName || "No provider";
              perProvider.set(name, (perProvider.get(name) ?? 0) + 1);
            }
            const providers = [...perProvider.entries()].sort((a, b) => b[1] - a[1]);
            const outside = !day.startsWith(month);
            return (
              <Link
                key={day}
                href={dayHref(day)}
                className={`month-cell ${outside ? "outside" : ""} ${day === today ? "today" : ""}`}
                title={`Open ${day}`}
              >
                <div className="month-num">
                  {Number(day.slice(8))}
                  {t.scheduled > 0 && <span className="pill">{t.scheduled}</span>}
                </div>
                {providers.slice(0, 3).map(([name, count]) => (
                  <div key={name} className="month-line">
                    {name} <strong>{count}</strong>
                  </div>
                ))}
                {providers.length > 3 && <div className="month-line muted">+{providers.length - 3} more</div>}
                {t.scheduled > 0 && (
                  <div className="month-flags">
                    {t.completed > 0 && <span className="pill ok">{t.completed} done</span>}
                    {t.absent > 0 && <span className="pill warn">{t.absent} abs</span>}
                    {t.canceled > 0 && <span className="pill">{t.canceled} can</span>}
                    {t.missed > 0 && <span className="pill bad">{t.missed} miss</span>}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
