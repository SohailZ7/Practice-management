"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import { NEW_TOKEN_COOKIE, clampTtlDays, expiryFrom, isScope, newApiToken } from "@/lib/mcpApi/tokens";
import {
  DEFAULT_ACCESS,
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
    data: MODULES.map((module) => ({ userId: user.id, module, level: DEFAULT_ACCESS[module] })),
  });
  // Everyone with a login gets an employee record (linked by email), so they have a task list.
  let linked = "";
  const employee = await db.employee.findUnique({ where: { email } });
  if (!employee) {
    await db.employee.create({ data: { name, email } });
    linked = " and an employee record";
  }
  await audit(admin.email, "user.add", `${email} as ${role}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Added ${email}${linked}. They can open Tasks, Schedule and Employees; change their access below.`);
}

export async function updateUser(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const role = str(form, "role");
  const active = form.get("active") === "on";
  const showFullNames = form.get("showFullNames") === "on";
  const feedbackApprover = form.get("feedbackApprover") === "on";
  const target = await db.user.findUnique({ where: { id } });
  if (!target) flash(BACK, "error", "User not found.");
  if (!isRole(role)) flash(BACK, "error", "Unknown role.");

  // Name and email are editable too. The email is what they sign in with (Google), so it can't be changed on your
  // own login (you would lock yourself out), and it must stay unique among users and employees.
  const name = str(form, "name") || target!.name;
  const email = normalizeEmail(str(form, "email") || target!.email);
  const emailChanged = email !== target!.email;
  if (emailChanged) {
    if (id === admin.id) flash(BACK, "error", "You can't change the email of your own login.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) flash(BACK, "error", "Enter a valid email address.");
    if (await db.user.findUnique({ where: { email } })) flash(BACK, "error", "That email is already a user.");
  }
  const employee = await db.employee.findUnique({ where: { email: target!.email } });
  if (emailChanged && employee && (await db.employee.findUnique({ where: { email } }))) {
    flash(BACK, "error", "An employee record already uses that email.");
  }

  if (wouldRemoveLastAdmin(await activeAdminIds(), id, { role, active })) {
    flash(BACK, "error", "There must always be at least one active administrator.");
  }
  await db.user.update({ where: { id }, data: { role, active, name, email, showFullNames, feedbackApprover } });
  // Keep the linked employee record (their task list) in step with the login.
  if (employee) await db.employee.update({ where: { id: employee.id }, data: { name, email } });
  // API-9: deactivating a user, or changing their email, ends their Desktop App sessions at once.
  if (!active || emailChanged) {
    await db.desktopSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.apiToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  await audit(
    admin.email,
    "user.update",
    `${target!.email}: role=${role} active=${active} fullNames=${showFullNames} feedbackApprover=${feedbackApprover}${emailChanged ? ` email -> ${email}` : ""}${name !== target!.name ? " name changed" : ""}`,
  );
  revalidatePath(BACK);
  flash(BACK, "notice", `Updated ${email}.`);
}

export async function setAccess(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) flash("/admin/access", "error", "User not found.");

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
  revalidatePath("/admin/access");
  flash("/admin/access", "notice", `Saved access for ${target!.email}.`);
}

/** TSK-59: for each employee tab, sets what this user can do there: none, view (read-only) or edit. */
export async function setTaskViewers(form: FormData) {
  const admin = await requireAdmin();
  const userId = str(form, "id");
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) flash("/admin/task-access", "error", "User not found.");
  const own = await db.employee.findUnique({ where: { email: target!.email }, select: { id: true } });
  const tabs = await db.employee.findMany({ where: { active: true, taskTab: true }, select: { id: true } });

  const rows: { userId: string; employeeId: string; level: string }[] = [];
  for (const t of tabs) {
    if (t.id === own?.id) continue; // everyone edits their own tab
    const level = str(form, `tab_${t.id}`);
    if (level === "view" || level === "edit") rows.push({ userId, employeeId: t.id, level });
  }
  await db.$transaction([db.taskViewer.deleteMany({ where: { userId } }), db.taskViewer.createMany({ data: rows })]);
  const edits = rows.filter((r) => r.level === "edit").length;
  await audit(admin.email, "taskviewers.set", `${target!.email}: ${rows.length - edits} view, ${edits} edit`);
  revalidatePath("/admin/task-access");
  flash("/admin/task-access", "notice", `Saved which task tabs ${target!.email} can view and edit.`);
}

/** TSK-58: shows an employee as a tab under Tasks, creating the employee first when a new name is given. */
export async function addTaskTab(form: FormData) {
  const admin = await requireAdmin();
  const existingId = str(form, "employeeId");
  const name = str(form, "name");
  if (existingId) {
    const e = await db.employee.findUnique({ where: { id: existingId } });
    if (!e) flash("/admin/task-tabs", "error", "Employee not found.");
    await db.employee.update({ where: { id: existingId }, data: { taskTab: true, active: true } });
    await audit(admin.email, "tasktab.add", `employee ${existingId}`);
    revalidatePath("/admin/task-tabs");
    flash("/admin/task-tabs", "notice", `${e!.name} now has a task tab.`);
  }
  if (!name) flash("/admin/task-tabs", "error", "Choose an employee or enter a name for the new tab.");
  const email = normalizeEmail(str(form, "email"));
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) flash("/admin/task-tabs", "error", "Enter a valid email address or leave it blank.");
  if (email && (await db.employee.findUnique({ where: { email } }))) flash("/admin/task-tabs", "error", "An employee with that email already exists: pick them from the list.");
  const created = await db.employee.create({ data: { name, email: email || null, taskTab: true } });
  await audit(admin.email, "tasktab.add", `new employee ${created.id}`);
  revalidatePath("/admin/task-tabs");
  flash("/admin/task-tabs", "notice", `Added a task tab for ${name}.`);
}

/**
 * TSK-58: hides an employee's tab. Open tasks move to Unassigned (each move logged); completed tasks and history
 * stay. Adding the tab again restores it.
 */
export async function removeTaskTab(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "employeeId");
  const e = await db.employee.findUnique({ where: { id } });
  if (!e) flash("/admin/task-tabs", "error", "Employee not found.");
  const open = await db.task.findMany({ where: { assigneeId: id, completed: false }, select: { id: true } });
  await db.$transaction([
    db.task.updateMany({ where: { id: { in: open.map((t) => t.id) } }, data: { assigneeId: null } }),
    db.taskMove.createMany({
      data: open.map((t) => ({ taskId: t.id, fromId: id, fromName: e!.name, toId: null, toName: "Unassigned", kind: "tab-removed", movedBy: admin.email })),
    }),
    db.employee.update({ where: { id }, data: { taskTab: false } }),
  ]);
  await audit(admin.email, "tasktab.remove", `employee ${id}: ${open.length} open task(s) moved to Unassigned`);
  revalidatePath("/admin/task-tabs");
  flash("/admin/task-tabs", "notice", `Removed ${e!.name}'s tab. ${open.length} open task(s) moved to Unassigned.`);
}

/**
 * Deletes a login. Their module access, task-tab grants and Mac app sessions go with it; their employee record
 * and tasks stay, and past audit entries keep the email. You can't delete yourself or the last administrator.
 * Deactivating (updateUser) is the reversible alternative.
 */
export async function deleteUser(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) flash(BACK, "error", "User not found.");
  if (target!.id === admin.id) flash(BACK, "error", "You can't delete your own login.");
  if (wouldRemoveLastAdmin(await activeAdminIds(), id, { role: "STAFF", active: false })) {
    flash(BACK, "error", "There must always be at least one active administrator.");
  }
  await db.user.delete({ where: { id } });
  await audit(admin.email, "user.delete", `${target!.email} (${target!.role})`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Deleted the login for ${target!.email}. Their employee record and tasks were kept.`);
}

/** API-9: the Admin can end every Desktop App session of a user. */
export async function revokeDesktopSessions(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const target = await db.user.findUnique({ where: { id } });
  if (!target) flash(BACK, "error", "User not found.");
  const res = await db.desktopSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(admin.email, "desktop.sessions.revoke", `user ${id} sessions=${res.count}`);
  revalidatePath(BACK);
  flash(BACK, "notice", `Signed ${target!.email} out of ${res.count} Mac app session(s).`);
}

const TOKENS = "/admin/api-tokens";

/**
 * Issues a Claude MCP token (tasks scope) for a user. The token is shown once: it travels in a short-lived HttpOnly
 * cookie, not in the redirect URL (URLs end up in request logs). Only its hash is stored.
 */
export async function issueApiToken(form: FormData) {
  const admin = await requireAdmin();
  const userId = str(form, "userId");
  const label = str(form, "label").slice(0, 60) || "Claude";
  const scope = isScope(str(form, "scope")) ? str(form, "scope") : "tasks";
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target || !target.active) flash(TOKENS, "error", "Choose an active user.");
  const { token, hash } = newApiToken();
  const days = clampTtlDays(str(form, "days"));
  const row = await db.apiToken.create({
    data: { userId, label, scope, tokenHash: hash, createdByEmail: admin.email, expiresAt: expiryFrom(days) },
  });
  await audit(admin.email, "mcp.token.issue", `token ${row.id} user ${userId} scope=${scope} days=${days}`);
  cookies().set(NEW_TOKEN_COOKIE, `${label}\n${token}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: TOKENS, maxAge: 60 });
  revalidatePath(TOKENS);
  flash(TOKENS, "notice", "Token created. Copy it now; it is not shown again.");
}

export async function revokeApiToken(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  const res = await db.apiToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count) await audit(admin.email, "mcp.token.revoke", `token ${id}`);
  revalidatePath(TOKENS);
  flash(TOKENS, "notice", res.count ? "Token revoked." : "That token was already revoked.");
}
