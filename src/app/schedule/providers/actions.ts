"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { flash, str } from "@/lib/flash";

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
  const created = await db.provider.create({ data: { name, employeeId } });
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
    },
  });
  await audit(user.email, "provider.update", `provider ${id}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Saved ${name}.`);
}
