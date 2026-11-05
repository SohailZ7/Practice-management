// Payments to timesheet employees, each mirrored by one cash-out row in the Ledger. Both are written in one transaction.
// Audit details hold ids, dates and amounts only.
import { db } from "../db";
import { audit } from "../audit";
import { ledgerComment, paymentError, formatMoney, type PaymentInput } from "./calc";

export class PaymentError extends Error {}

type Actor = { id: string; email: string };

async function ledgerParts(methodId: string | null) {
  const payroll = await db.ledgerCategory.findFirst({ where: { name: { equals: "Payroll", mode: "insensitive" } } });
  const method = methodId ? await db.ledgerMethod.findUnique({ where: { id: methodId } }) : null;
  if (methodId && !method) throw new PaymentError("That payment method no longer exists. Refresh the page.");
  return { categoryId: payroll?.id ?? null, methodId: method?.id ?? null };
}

export async function addPayment(actor: Actor, employeeId: string, p: PaymentInput, methodId: string | null) {
  const emp = await db.timesheetEmployee.findUnique({ where: { id: employeeId } });
  if (!emp) throw new PaymentError("Employee not found.");
  const bad = paymentError(p);
  if (bad) throw new PaymentError(bad);
  const parts = await ledgerParts(methodId);
  const row = await db.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.create({
      data: { date: p.date, cashIn: 0, cashOut: p.amountCents, ...parts, comments: ledgerComment(emp.name, p.coversMonth, p.note), createdById: actor.id },
    });
    return tx.timesheetPayment.create({
      data: { employeeId, date: p.date, amountCents: p.amountCents, methodId: parts.methodId, note: p.note, coversMonth: p.coversMonth, ledgerEntryId: entry.id, createdById: actor.id },
    });
  });
  await audit(actor.email, "timesheet.pay.add", `${row.id} emp ${employeeId} ${p.date} ${formatMoney(p.amountCents)} ledger ${row.ledgerEntryId}`);
  return row;
}

export async function editPayment(actor: Actor, id: string, p: PaymentInput, methodId: string | null) {
  const existing = await db.timesheetPayment.findUnique({ where: { id }, include: { employee: true } });
  if (!existing) throw new PaymentError("Payment not found.");
  const bad = paymentError(p);
  if (bad) throw new PaymentError(bad);
  const parts = await ledgerParts(methodId);
  const row = await db.$transaction(async (tx) => {
    const data = { date: p.date, cashIn: 0, cashOut: p.amountCents, ...parts, comments: ledgerComment(existing.employee.name, p.coversMonth, p.note) };
    if (existing.ledgerEntryId && (await tx.ledgerEntry.findUnique({ where: { id: existing.ledgerEntryId } }))) {
      await tx.ledgerEntry.update({ where: { id: existing.ledgerEntryId }, data });
      return tx.timesheetPayment.update({ where: { id }, data: { date: p.date, amountCents: p.amountCents, methodId: parts.methodId, note: p.note, coversMonth: p.coversMonth } });
    }
    // The ledger row is missing (should not happen): recreate it so the two stay in step.
    const entry = await tx.ledgerEntry.create({ data: { ...data, createdById: actor.id } });
    return tx.timesheetPayment.update({ where: { id }, data: { date: p.date, amountCents: p.amountCents, methodId: parts.methodId, note: p.note, coversMonth: p.coversMonth, ledgerEntryId: entry.id } });
  });
  await audit(actor.email, "timesheet.pay.edit", `${id} ${existing.date} ${formatMoney(existing.amountCents)} -> ${p.date} ${formatMoney(p.amountCents)}`);
  return row;
}

export async function removePayment(actor: Actor, id: string) {
  const existing = await db.timesheetPayment.findUnique({ where: { id } });
  if (!existing) return;
  await db.$transaction(async (tx) => {
    await tx.timesheetPayment.delete({ where: { id } });
    if (existing.ledgerEntryId) await tx.ledgerEntry.deleteMany({ where: { id: existing.ledgerEntryId } });
  });
  await audit(actor.email, "timesheet.pay.delete", `${id} ${existing.date} ${formatMoney(existing.amountCents)} ledger ${existing.ledgerEntryId}`);
}

/** Message the Ledger shows when someone tries to change a row that belongs to a timesheet payment. */
export const LINKED_LEDGER_MESSAGE = "This entry belongs to a Timesheet payment. Change or delete it under Admin > Timesheets so the two stay in step.";

export async function isLinkedLedgerEntry(ledgerEntryId: string): Promise<boolean> {
  return !!(await db.timesheetPayment.findUnique({ where: { ledgerEntryId }, select: { id: true } }));
}
