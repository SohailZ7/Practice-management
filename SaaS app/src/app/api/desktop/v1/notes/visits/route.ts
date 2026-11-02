import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isISODate, todayISO } from "@/lib/dates";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { patientInitials } from "@/lib/notes/patientFolder";

export const dynamic = "force-dynamic";

/**
 * A day's visits, for the recorder. Patient names are sent as initials: the recorder only has to show the provider
 * which visit they are recording, and does not need the name for anything.
 */
export const GET = handle(async (req) => {
  const { user } = await authenticate(req, { module: "notes", level: "edit" });
  const date = new URL(req.url).searchParams.get("date") ?? todayISO();
  if (!isISODate(date)) throw new ApiError(400, "bad_date");

  const visits = await db.visit.findMany({
    where: { visitDate: date },
    include: { patient: true, documents: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
  await audit(user.email, "desktop.notes.visits", `${date} visits=${visits.length}`);
  return json({
    date,
    visits: visits.map((v) => ({
      id: v.id,
      initials: patientInitials(v.patient.lastName, v.patient.firstName),
      program: v.program,
      appointmentType: v.appointmentType,
      providerName: v.providerName,
      hasTranscript: v.transcript.trim().length > 0,
      documentCount: v.documents.length,
    })),
  });
});
