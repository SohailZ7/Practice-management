"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import {
  MODULES,
  isLevel,
  isModule,
  isRole,
  normalizeEmail,
  wouldRemoveLastAdmin,
} from "@/lib/access";

const BACK = "/admin";

async function activeAdminIds(): Promise<string[]> {
  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  return admins.map((a) => a.id);
}

export async function addUser(form: FormData) {
  const admin = await requireAdmin();
  const email = normalizeEmail(str(form, "email"));
  const name = str(form, "name");
  const role = str(form, "role") || "STAFF";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) flash(BACK, "error", "Enter a valid email address.");
  if (!name) flash(BACK, "error", "Enter a name.");
  if (!isRole(role)) flash(BACK, "error", "Unknown role.");
  if (await db.user.findUnique({ where: { email } })) flash(BACK, "error", "That email is already a user.");

  const user = await db.user.create({ data: { email, name, role } });
  await db.moduleAccess.createMany({
    data: MODULES.map((module) => ({ userId: user.id, module, level: "none" })),
  });
  await audit(admin.email, "user.add", `${email} as ${role}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Added ${email}. Set their module access below.`);
}

export async function updateUser(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const role = str(form, "role");
  const active = form.get("active") === "on";
  const target = await db.user.findUnique({ where: { id } });
  if (!target) flash(BACK, "error", "User not found.");
  if (!isRole(role)) flash(BACK, "error", "Unknown role.");

  if (wouldRemoveLastAdmin(await activeAdminIds(), id, { role, active })) {
    flash(BACK, "error", "There must always be at least one active administrator.");
  }
  await db.user.update({ where: { id }, data: { role, active } });
  await audit(admin.email, "user.update", `${target!.email}: role=${role} active=${active}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Updated ${target!.email}.`);
}

export async function setAccess(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) flash(BACK, "error", "User not found.");

  const changes: string[] = [];
  for (const module of MODULES) {
    const level = str(form, `level_${module}`);
    if (!isModule(module) || !isLevel(level)) continue;
    await db.moduleAccess.upsert({
      where: { userId_module: { userId: id, module } },
      update: { level },
      create: { userId: id, module, level },
    });
    changes.push(`${module}=${level}`);
  }
  await audit(admin.email, "access.set", `${target!.email}: ${changes.join(", ")}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Saved access for ${target!.email}.`);
}
