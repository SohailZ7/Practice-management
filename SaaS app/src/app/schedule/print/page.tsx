import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatLong, isISODate, todayISO } from "@/lib/dates";
import { visitsForDate } from "@/lib/notes/queries";
import { formatTimeText } from "@/lib/notes/scheduleTime";
import { PrintButton } from "@/components/notes/PrintButton";

/** The day's schedule on one printable page: 18 pt, black on white, in the order shown on the Schedule tab. */
export default async function PrintSchedule({ searchParams }: { searchParams: { date?: string; provider?: string } }) {
  const user = await requireUser();
  if (!canAccess(user, "notes", "view")) redirect("/denied");
  const date = searchParams.date && isISODate(searchParams.date) ? searchParams.date : todayISO();
  const providerish = user.role === "ADMIN" || user.role === "PROVIDER";
  const military = cookies().get("bbc_clock")?.value === "24";
  const filter = searchParams.provider
    ? (await db.provider.findUnique({ where: { id: searchParams.provider }, select: { name: true } }))?.name
    : undefined;
  const all = await visitsForDate(date, { fullNames: providerish && user.showFullNames });
  const visits = filter ? all.filter((v) => v.providerName === filter) : all;
  // A count only: no patient names in the audit trail.
  await audit(user.email, "schedule.print", `${date} visits=${visits.length}`);

  return (
    <div className="print-sheet">
      <div className="print-bar">
        <Link href={`/schedule?view=day&date=${date}`}>← Schedule</Link>
        <PrintButton />
      </div>
      <h1>{formatLong(date)}{filter ? ` · ${filter}` : ""}</h1>
      {visits.length === 0 ? (
        <p>No visits for this day.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Patient</th>
              <th>Program</th>
              <th>Type</th>
              {providerish && <th>Provider</th>}
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id} className={v.trackingOnly ? "tracking" : undefined}>
                <td>{formatTimeText(v.apptTime, military)}</td>
                <td>{v.fullName ?? v.initials}</td>
                <td>{v.program}</td>
                <td>{v.appointmentType}</td>
                {providerish && <td>{v.providerName}{v.trackingOnly ? " (not B&B)" : ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
