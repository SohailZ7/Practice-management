import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isISODate, todayISO } from "@/lib/dates";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { programOf } from "@/lib/desktop/policy";
import { entryDTOs } from "@/lib/patients";

export const dynamic = "force-dynamic";

// API-4: one day's schedule, read-only (API-10). Dates are practice-time-zone YYYY-MM-DD strings.
export const GET = handle(async (req) => {
  const { user } = await authenticate(req, { module: "schedule", level: "view" });
  const q = new URL(req.url).searchParams.get("date");
  const date = q ?? todayISO();
  if (!isISODate(date)) throw new ApiError(400, "bad_date");

  const rows = await db.scheduleEntry.findMany({ where: { date }, orderBy: [{ createdAt: "asc" }] });
  const dtos = await entryDTOs(rows);
  const ids = [...new Set(dtos.map((d) => d.patientId).filter((x): x is string => !!x))];
  const patients = ids.length ? await db.billingPatient.findMany({ where: { id: { in: ids } }, select: { id: true, lastName: true, firstName: true } }) : [];
  const byId = new Map(patients.map((p) => [p.id, p]));

  await audit(user.email, "desktop.schedule.view", `${date} entries=${rows.length}`);
  return json({
    date,
    entries: rows.map((r, i) => {
      const d = dtos[i];
      const p = d.patientId ? byId.get(d.patientId) : undefined;
      return {
        id: r.id,
        time: r.timeLabel,
        program: programOf(r),
        type: r.typeName,
        provider: r.providerId ? { id: r.providerId, name: r.providerName } : r.providerName ? { id: null, name: r.providerName } : null,
        status: { absent: r.absent, canceled: r.canceled, completed: r.completed, missed: r.missed },
        patient: p ? { id: p.id, lastName: p.lastName, firstName: p.firstName } : null,
        clientInfo: p ? "" : r.clientInfo,
        consent: d.consent,
      };
    }),
  });
});
