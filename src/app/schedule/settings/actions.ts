"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { flash, str } from "@/lib/flash";

const BACK = "/schedule/settings";

export async function addTrack(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const name = str(form, "name");
  if (!name) flash(BACK, "error", "Enter a track name.");
  if (await db.trackDef.findUnique({ where: { name } })) flash(BACK, "error", "That track already exists.");
  const count = await db.trackDef.count();
  await db.trackDef.create({
    data: { name, startTime: str(form, "startTime"), endTime: str(form, "endTime"), sortOrder: count },
  });
  await audit(user.email, "track.add", name);
  revalidatePath(BACK);
  flash(BACK, "notice", `Added track ${name}.`);
}

export async function deleteTrack(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const id = str(form, "id");
  await db.trackDef.delete({ where: { id } }).catch(() => undefined);
  await audit(user.email, "track.delete", id);
  revalidatePath(BACK);
  flash(BACK, "notice", "Track removed. Existing entries keep their text.");
}

export async function addEntryType(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const name = str(form, "name");
  if (!name) flash(BACK, "error", "Enter a type name.");
  if (await db.entryType.findUnique({ where: { name } })) flash(BACK, "error", "That type already exists.");
  await db.entryType.create({ data: { name } });
  await audit(user.email, "entrytype.add", name);
  revalidatePath(BACK);
  flash(BACK, "notice", `Added type ${name}.`);
}

export async function deleteEntryType(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const id = str(form, "id");
  await db.entryType.delete({ where: { id } }).catch(() => undefined);
  await audit(user.email, "entrytype.delete", id);
  revalidatePath(BACK);
  flash(BACK, "notice", "Type removed. Existing entries keep their text.");
}
