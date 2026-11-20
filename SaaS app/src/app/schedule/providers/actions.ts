"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import { TIME_OFF_KINDS, validateTimeOff } from "@/lib/schedule/timeOff";

const BACK = "/schedule/providers";

export async function addProvider(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const name = str(form, "name");
  if (!name) flash(BACK, "error", "Enter a name.");
  if (await db.provider.findUnique({ where: { name } })) flash(BACK, "error", "That provider already exists.");
  const employeeId = str(form, "employeeId") || null;
  if (employeeId && (await db.provider.findUnique({ where: { employeeId } }))) {
    flash(BACK, "error", "That employee is already linked to a provider.");
  }
  const created = await db.provider.create({ data: { name, employeeId, trackingOnly: form.get("trackingOnly") === "on" } });
  await audit(user.email, "provider.add", `provider ${created.id}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Added ${name}.`);
}

export async function saveProvider(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const id = str(form, "id");
  const name = str(form, "name");
  if (!name) flash(BACK, "error", "Name cannot be blank.");
  const other = await db.provider.findUnique({ where: { name } });
  if (other && other.id !== id) flash(BACK, "error", "Another provider already uses that name.");
  await db.provider.update({
    where: { id },
    data: {
      name,
      contact: str(form, "contact"),
      npi: str(form, "npi"),
      zoomLink: str(form, "zoomLink"),
      zoomPassword: str(form, "zoomPassword"),
      hours: str(form, "hours"),
      notes: str(form, "notes"),
      trackingOnly: form.get("trackingOnly") === "on",
    },
  });
  await audit(user.email, "provider.update", `provider ${id} trackingOnly=${form.get("trackingOnly") === "on"}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Saved ${name}.`);
}

export async function addTimeOff(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const providerId = str(form, "providerId");
  const startDate = str(form, "startDate");
  const endDate = str(form, "endDate") || startDate;
  const err = validateTimeOff(startDate, endDate);
  if (err) flash(BACK, "error", err);
  if (!(await db.provider.findUnique({ where: { id: providerId } }))) flash(BACK, "error", "Provider not found.");
  const kind = TIME_OFF_KINDS.some((k) => k.value === str(form, "kind")) ? str(form, "kind") : "time_off";
  const created = await db.providerTimeOff.create({
    data: { providerId, startDate, endDate, kind, note: str(form, "note"), createdByEmail: user.email },
  });
  await audit(user.email, "provider.timeoff.add", `provider ${providerId} entry ${created.id}`);
  revalidatePath(BACK);
  flash(BACK, "notice", "Unavailable days added.");
}

export async function removeTimeOff(form: FormData) {
  const user = await requireAccess("schedule", "edit");
  const id = str(form, "id");
  await db.providerTimeOff.deleteMany({ where: { id } });
  await audit(user.email, "provider.timeoff.remove", `entry ${id}`);
  revalidatePath(BACK);
  flash(BACK, "notice", "Removed.");
}
