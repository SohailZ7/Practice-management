"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { isISODate } from "@/lib/dates";
import { makeDedupeKey } from "@/lib/import/outpatientBoard";
import { entryDTO } from "@/lib/patients";
import { visitAsEntry } from "@/lib/schedule/rows";
import { timeColumns, statusFromFlags } from "@/lib/unify/plan";
import { syncScheduleForVisit } from "@/lib/notes/visitSchedule";
import { flagsForStatus } from "@/lib/notes/visitStatus";
import { type EntryDTO, type EntryPatch, type Section } from "@/lib/scheduleTypes";

const MAX_TEXT = 500;

function clean(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asSection(value: unknown): Section {
  if (value === "PSYCH_EVAL" || value === "TRACK") return value;
  throw new Error("Invalid section");
}

async function providerFor(providerId: string | null | undefined) {
  if (!providerId) return { providerId: null, providerName: "" };
  const p = await db.provider.findUnique({ where: { id: providerId } });
  if (!p) throw new Error("Provider not found");
  return { providerId: p.id, providerName: p.name };
}

export async function createEntry(input: {
  date: string;
  section: Section;
  timeLabel?: string;
  typeName?: string;
  clientInfo: string;
  providerId?: string | null;
}): Promise<EntryDTO> {
  const user = await requireAccess("schedule", "edit");
  if (!isISODate(input.date)) throw new Error("Invalid date");
  const section = asSection(input.section);
  const clientInfo = clean(input.clientInfo);
  if (!clientInfo) throw new Error("Enter the client's name or info");
  const timeLabel = clean(input.timeLabel, 120);
  const { providerId, providerName } = await providerFor(input.providerId);

  const entry = await db.scheduleEntry.create({
    data: {
      date: input.date,
      section,
      timeLabel,
      trackName: section === "TRACK" ? timeLabel : "",
      typeName: clean(input.typeName, 120),
      clientInfo,
      providerId,
      providerName,
      dedupeKey: makeDedupeKey({ date: input.date, section, timeLabel, providerName, clientInfo }),
    },
  });
  await audit(user.email, "schedule.add", `entry ${entry.id} ${entry.date} ${section}`);
  revalidatePath("/schedule");
  return entryDTO(entry);
}

/** Release B1: a Visit row is edited as the Visit (mirror re-synced for rollback). Returns null when the id is not a Visit. */
async function updateVisitRow(email: string, id: string, patch: EntryPatch): Promise<EntryDTO | null> {
  const v = await db.visit.findUnique({ where: { id }, include: { patient: { select: { lastName: true, firstName: true } } } });
  if (!v) return null;
  if (patch.clientInfo !== undefined && patch.clientInfo.trim() !== `${v.patient.lastName}, ${v.patient.firstName}`.trim()) {
    throw new Error("A visit's patient cannot be retyped. Remove the visit and add it again for another patient.");
  }
  const cur = visitAsEntry(v);
  const section = patch.section !== undefined ? asSection(patch.section) : asSection(cur.section);
  const timeLabel = patch.timeLabel !== undefined ? clean(patch.timeLabel, 120) : cur.timeLabel;
  const prov = patch.providerId !== undefined ? await providerFor(patch.providerId) : { providerId: v.providerId, providerName: v.providerName };
  const flagsTouched = (["absent", "canceled", "completed", "missed"] as const).some((k) => patch[k] !== undefined);
  const flags = { ...flagsForStatus(v.status), ...Object.fromEntries((["absent", "canceled", "completed", "missed"] as const).filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]])) };
  const t = timeColumns(timeLabel);
  const data = {
    section,
    timeLabel,
    trackName: section === "TRACK" ? timeLabel : "",
    program: section === "TRACK" ? timeLabel : "",
    apptTime: section === "TRACK" ? "" : timeLabel,
    startTime: t.startTime,
    endTime: t.endTime,
    appointmentType: patch.typeName !== undefined ? clean(patch.typeName, 120) : v.appointmentType,
    providerId: prov.providerId,
    providerName: prov.providerName,
    ...(flagsTouched ? { status: statusFromFlags(flags as { absent: boolean; canceled: boolean; completed: boolean; missed: boolean }).status } : {}),
  };
  const updated = await db.visit.update({ where: { id }, data, include: { patient: { select: { lastName: true, firstName: true } } } });
  await syncScheduleForVisit(id);
  await audit(email, "schedule.update", `visit ${id} ${v.visitDate} fields=${Object.keys(patch).join(",")}`);
  revalidatePath("/schedule");
  return entryDTO(visitAsEntry(updated));
}

export async function updateEntry(id: string, patch: EntryPatch): Promise<EntryDTO> {
  const user = await requireAccess("schedule", "edit");
  const asVisit = await updateVisitRow(user.email, id, patch);
  if (asVisit) return asVisit;
  const existing = await db.scheduleEntry.findUnique({ where: { id } });
  if (!existing) throw new Error("Entry not found");

  const section = patch.section !== undefined ? asSection(patch.section) : asSection(existing.section);
  const timeLabel = patch.timeLabel !== undefined ? clean(patch.timeLabel, 120) : existing.timeLabel;
  const clientInfo = patch.clientInfo !== undefined ? clean(patch.clientInfo) : existing.clientInfo;
  if (!clientInfo) throw new Error("Client info cannot be blank");
  const prov =
    patch.providerId !== undefined
      ? await providerFor(patch.providerId)
      : { providerId: existing.providerId, providerName: existing.providerName };

  const updated = await db.scheduleEntry.update({
    where: { id },
    data: {
      section,
      timeLabel,
      trackName: section === "TRACK" ? timeLabel : "",
      typeName: patch.typeName !== undefined ? clean(patch.typeName, 120) : existing.typeName,
      clientInfo,
      // PAT-2: a hand-edited client name no longer matches the linked patient, so the link is dropped.
      patientId: clientInfo !== existing.clientInfo ? null : existing.patientId,
      providerId: prov.providerId,
      providerName: prov.providerName,
      absent: patch.absent ?? existing.absent,
      canceled: patch.canceled ?? existing.canceled,
      completed: patch.completed ?? existing.completed,
      missed: patch.missed ?? existing.missed,
      dedupeKey: makeDedupeKey({
        date: existing.date,
        section,
        timeLabel,
        providerName: prov.providerName,
        clientInfo,
      }),
    },
  });
  await audit(user.email, "schedule.update", `entry ${id} ${existing.date} fields=${Object.keys(patch).join(",")}`);
  revalidatePath("/schedule");
  return entryDTO(updated);
}

export async function removeEntry(id: string): Promise<void> {
  const user = await requireAccess("schedule", "edit");
  const visit = await db.visit.findUnique({ where: { id }, select: { id: true, visitDate: true, transcript: true, _count: { select: { documents: true } } } });
  if (visit) {
    // A visit with a transcript or documents is clinical record: it is removed from Notes, not from the Schedule grid.
    if (visit.transcript || visit._count.documents > 0) throw new Error("This visit has a recording or documents. Delete it from Notes instead.");
    await db.visit.delete({ where: { id } });
    await db.scheduleEntry.deleteMany({ where: { visitId: id } });
    await audit(user.email, "schedule.delete", `visit ${id} ${visit.visitDate}`);
    revalidatePath("/schedule");
    return;
  }
  const existing = await db.scheduleEntry.findUnique({ where: { id } });
  await db.scheduleEntry.delete({ where: { id } }).catch(() => undefined);
  if (existing) await audit(user.email, "schedule.delete", `entry ${id} ${existing.date}`);
  revalidatePath("/schedule");
}
