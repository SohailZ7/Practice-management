"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { bool, flash, str } from "@/lib/flash";
import { isISODate } from "@/lib/dates";
import { makeDedupeKey } from "@/lib/import/outpatientBoard";

function boardPath(date: string, provider?: string) {
  const q = new URLSearchParams({ date });
  if (provider) q.set("provider", provider);
  return `/schedule?${q.toString()}`;
}

async function resolveProvider(providerId: string, fallbackName: string) {
  if (!providerId) return { providerId: null, providerName: fallbackName };
  const p = await db.provider.findUnique({ where: { id: providerId } });
  return p ? { providerId: p.id, providerName: p.name } : { providerId: null, providerName: fallbackName };
}

export async function addEntry(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const date = str(form, "date");
  const section = str(form, "section");
  const back = boardPath(date, str(form, "filterProvider"));
  if (!isISODate(date)) flash("/schedule", "error", "Invalid date.");
  if (section !== "PSYCH_EVAL" && section !== "TRACK") flash(back, "error", "Invalid section.");
  const clientInfo = str(form, "clientInfo");
  if (!clientInfo) flash(back, "error", "Enter client info.");

  const timeLabel = str(form, "timeLabel");
  const { providerId, providerName } = await resolveProvider(str(form, "providerId"), "");
  const entry = await db.scheduleEntry.create({
    data: {
      date,
      section,
      timeLabel,
      trackName: section === "TRACK" ? timeLabel : "",
      typeName: str(form, "typeName"),
      clientInfo,
      providerId,
      providerName,
      dedupeKey: makeDedupeKey({ date, section, timeLabel, providerName, clientInfo }),
    },
  });
  await audit(user.email, "schedule.add", `${entry.date} ${section} ${timeLabel}`);
  revalidatePath("/schedule");
  flash(back, "notice", "Entry added.");
}

export async function saveEntry(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const id = str(form, "id");
  const date = str(form, "date");
  const back = boardPath(date, str(form, "filterProvider"));
  const clientInfo = str(form, "clientInfo");
  if (!clientInfo) flash(back, "error", "Client info cannot be blank.");

  const existing = await db.scheduleEntry.findUnique({ where: { id } });
  if (!existing) flash(back, "error", "Entry not found.");
  const timeLabel = str(form, "timeLabel");
  const { providerId, providerName } = await resolveProvider(
    str(form, "providerId"),
    str(form, "providerName"),
  );
  await db.scheduleEntry.update({
    where: { id },
    data: {
      timeLabel,
      trackName: existing!.section === "TRACK" ? timeLabel : "",
      typeName: str(form, "typeName"),
      clientInfo,
      providerId,
      providerName,
      absent: bool(form, "absent"),
      canceled: bool(form, "canceled"),
      completed: bool(form, "completed"),
      missed: bool(form, "missed"),
      dedupeKey: makeDedupeKey({
        date: existing!.date,
        section: existing!.section,
        timeLabel,
        providerName,
        clientInfo,
      }),
    },
  });
  await audit(user.email, "schedule.update", `${existing!.date} ${timeLabel}`);
  revalidatePath("/schedule");
  flash(back, "notice", "Entry saved.");
}

export async function deleteEntry(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const id = str(form, "id");
  const date = str(form, "date");
  const back = boardPath(date, str(form, "filterProvider"));
  await db.scheduleEntry.delete({ where: { id } }).catch(() => undefined);
  await audit(user.email, "schedule.delete", `${date} ${id}`);
  revalidatePath("/schedule");
  flash(back, "notice", "Entry deleted.");
}
