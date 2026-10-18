"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { bool, flash, str } from "@/lib/flash";
import { normalizeEmail } from "@/lib/access";

const BACK = "/employees";

function validEmail(email: string) {
  return email === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export async function addEmployee(form: FormData) {
  const user = await requireAccess("employees", "edit");
  const name = str(form, "name");
  const email = normalizeEmail(str(form, "email"));
  if (!name) flash(BACK, "error", "Enter a name.");
  if (!validEmail(email)) flash(BACK, "error", "Enter a valid email address.");
  if (email && (await db.employee.findUnique({ where: { email } }))) {
    flash(BACK, "error", "An employee with that email already exists.");
  }
  await db.employee.create({
    data: { name, email: email || null, title: str(form, "title"), phone: str(form, "phone") },
  });
  await audit(user.email, "employee.add", name);
  revalidatePath(BACK);
  flash(BACK, "notice", `Added ${name}.`);
}

export async function updateEmployee(form: FormData) {
  const user = await requireAccess("employees", "edit");
  const id = str(form, "id");
  const name = str(form, "name");
  const email = normalizeEmail(str(form, "email"));
  if (!name) flash(BACK, "error", "Name cannot be blank.");
  if (!validEmail(email)) flash(BACK, "error", "Enter a valid email address.");
  if (email) {
    const other = await db.employee.findUnique({ where: { email } });
    if (other && other.id !== id) flash(BACK, "error", "Another employee already uses that email.");
  }
  await db.employee.update({
    where: { id },
    data: {
      name,
      email: email || null,
      title: str(form, "title"),
      phone: str(form, "phone"),
      active: bool(form, "active"),
    },
  });
  await audit(user.email, "employee.update", name);
  revalidatePath(BACK);
  flash(BACK, "notice", `Saved ${name}.`);
}
