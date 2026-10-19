// Database helpers for patient links and consent on the schedule (requirements v19, section 5.7).
import type { ScheduleEntry } from "@prisma/client";
import { db } from "./db";
import { consentBadge } from "./consent";
import { toEntryDTO, type EntryDTO } from "./scheduleTypes";

/** PAT-4: follow "merged into" so a merged patient always resolves to the surviving record. */
export async function survivingPatientId(id: string | null): Promise<string | null> {
  let current = id;
  for (let i = 0; current && i < 10; i++) {
    const p = await db.billingPatient.findUnique({ where: { id: current }, select: { mergedIntoId: true } });
    if (!p) return null;
    if (!p.mergedIntoId) return current;
    current = p.mergedIntoId;
  }
  return current;
}

/** Entries -> DTOs with the resolved patient and consent badge, using two queries however many rows there are. */
export async function entryDTOs(rows: ScheduleEntry[]): Promise<EntryDTO[]> {
  const ids = [...new Set(rows.map((r) => r.patientId).filter((x): x is string => !!x))];
  if (ids.length === 0) return rows.map((r) => toEntryDTO(r));
  const patients = await db.billingPatient.findMany({
    where: { id: { in: ids } },
    select: { id: true, mergedIntoId: true },
  });
  const resolved = new Map<string, string>();
  for (const id of ids) {
    let cur = id;
    for (let i = 0; i < 10; i++) {
      const p = patients.find((x) => x.id === cur);
      if (!p?.mergedIntoId) break;
      cur = p.mergedIntoId;
      if (!patients.some((x) => x.id === cur)) patients.push({ id: cur, mergedIntoId: null });
    }
    resolved.set(id, cur);
  }
  const consents = await db.patientConsent.findMany({
    where: { patientId: { in: [...new Set(resolved.values())] }, active: true },
    select: { patientId: true, active: true, consentDate: true },
  });
  return rows.map((r) => {
    const pid = r.patientId ? (resolved.get(r.patientId) ?? r.patientId) : null;
    const own = consents.filter((c) => c.patientId === pid);
    return toEntryDTO(r, { patientId: pid, consent: consentBadge(pid, own) });
  });
}

export async function entryDTO(row: ScheduleEntry): Promise<EntryDTO> {
  return (await entryDTOs([row]))[0];
}
