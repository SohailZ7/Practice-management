"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAdmin, type CurrentUser } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import {
  chargeCents,
  entryError,
  formatMoney,
  formatTime,
  isMonthKey,
  minutesWorked,
  monthKey,
  parseRate,
  parseTime,
  timesheetAccess,
} from "@/lib/timesheets/calc";

const BASE = "/admin/timesheets";

async function gate(): Promise<CurrentUser> {
  const user = await requireAdmin();
  // One checkpoint for every read and write; a later release widens timesheetAccess, not each action.
  if (timesheetAccess(user) !== "all") flash(BASE, "error", "No access.");
  return user;
}

function back(employeeId: string, month: string) {
  return `${BASE}?e=${encodeURIComponent(employeeId)}&m=${isMonthKey(month) ? month : ""}`;
}

function readEntry(form: FormData, fallbackRate: number, backTo: string) {
  const startMin = parseTime(str(form, "start"));
  const endMin = parseTime(str(form, "end"));
  const rateRaw = str(form, "rate");
  const rateCents = rateRaw ? parseRate(rateRaw) : fallbackRate;
  const date = str(form, "date");
  if (startMin === null || endMin === null) flash(backTo, "error", "Enter start and end times like 5:27 PM.");
  if (rateCents === null) flash(backTo, "error", "Enter an hourly rate like 23 or 23.50.");
  const entry = { date, startMin: startMin as number, endMin: endMin as number, rateCents: rateCents as number };
  const error = entryError(entry);
  if (error) flash(backTo, "error", error);
  return entry;
}

// Audit detail holds ids, dates, times and amounts only.
const describe = (e: { date: string; startMin: number; endMin: number; rateCents: number }) => {
  const m = minutesWorked(e.startMin, e.endMin);
  return `${e.date} ${formatTime(e.startMin)}-${formatTime(e.endMin)} ${m}min @${formatMoney(e.rateCents)} = ${formatMoney(chargeCents(m, e.rateCents))}`;
};

export async function addTimesheetEntry(form: FormData) {
  const user = await gate();
  const employeeId = str(form, "employeeId");
  const emp = await db.timesheetEmployee.findUnique({ where: { id: employeeId } });
  if (!emp) flash(BASE, "error", "Choose an employee.");
  const e = emp!;
  const to = back(e.id, monthKey(str(form, "date")));
  const entry = readEntry(form, e.defaultRateCents, to);
  const row = await db.timesheetEntry.create({ data: { ...entry, employeeId: e.id, createdById: user.id } });
  await audit(user.email, "timesheet.add", `${row.id} emp ${e.id}: ${describe(row)}`);
  revalidatePath(BASE);
  flash(to, "notice", "Entry added.");
}

export async function updateTimesheetEntry(form: FormData) {
  const user = await gate();
  const id = str(form, "id");
  const existing = await db.timesheetEntry.findUnique({ where: { id } });
  if (!existing) flash(BASE, "error", "Entry not found.");
  const old = existing!;
  const entry = readEntry(form, old.rateCents, back(old.employeeId, monthKey(old.date)));
  const to = back(old.employeeId, monthKey(entry.date));
  await db.timesheetEntry.update({ where: { id }, data: entry });
  await audit(user.email, "timesheet.edit", `${id}: ${describe(old)} -> ${describe(entry)}`);
  revalidatePath(BASE);
  flash(to, "notice", "Entry saved.");
}

export async function deleteTimesheetEntry(form: FormData) {
  const user = await gate();
  const id = str(form, "id");
  const existing = await db.timesheetEntry.findUnique({ where: { id } });
  if (existing) {
    await db.timesheetEntry.delete({ where: { id } });
    await audit(user.email, "timesheet.delete", `${id}: ${describe(existing)}`);
  }
  revalidatePath(BASE);
  flash(back(existing?.employeeId ?? "", existing ? monthKey(existing.date) : ""), "notice", "Entry deleted.");
}

export async function setEmployeeRate(form: FormData) {
  const user = await gate();
  const id = str(form, "employeeId");
  const rate = parseRate(str(form, "rate"));
  if (rate === null || rate > 100000) flash(back(id, ""), "error", "Enter an hourly rate like 23 or 23.50.");
  const res = await db.timesheetEmployee.updateMany({ where: { id }, data: { defaultRateCents: rate as number } });
  if (res.count) await audit(user.email, "timesheet.rate", `emp ${id}: default ${formatMoney(rate as number)}/hr`);
  revalidatePath(BASE);
  flash(back(id, ""), "notice", "Default rate saved. Existing entries keep their own rate.");
}
