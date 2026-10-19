"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { isISODate } from "@/lib/dates";
import { makeDedupeKey } from "@/lib/import/outpatientBoard";
import { toEntryDTO, type EntryDTO, type EntryPatch, type Section } from "@/lib/scheduleTypes";

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
  return toEntryDTO(entry);
}

export async function updateEntry(id: string, patch: EntryPatch): Promise<EntryDTO> {
  const user = await requireAccess("schedule", "edit");
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
  return toEntryDTO(updated);
}

export async function removeEntry(id: string): Promise<void> {
  const user = await requireAccess("schedule", "edit");
  const existing = await db.scheduleEntry.findUnique({ where: { id } });
  await db.scheduleEntry.delete({ where: { id } }).catch(() => undefined);
  if (existing) await audit(user.email, "schedule.delete", `entry ${id} ${existing.date}`);
  revalidatePath("/schedule");
}
