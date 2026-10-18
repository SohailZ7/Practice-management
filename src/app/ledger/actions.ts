"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { formatMoney } from "@/lib/ledger/money";
import { ledgerEntryError } from "@/lib/ledger/validate";
import { queryLedger, toLedgerDTO } from "@/lib/ledger/queries";
import type { LedgerDTO, LedgerFilters, LedgerPatch, OptionKind } from "@/lib/ledger/types";

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function checkRefs(e: { partyId?: string | null; categoryId?: string | null; methodId?: string | null }) {
  const [p, c, m] = await Promise.all([
    e.partyId ? db.ledgerParty.findUnique({ where: { id: e.partyId } }) : true,
    e.categoryId ? db.ledgerCategory.findUnique({ where: { id: e.categoryId } }) : true,
    e.methodId ? db.ledgerMethod.findUnique({ where: { id: e.methodId } }) : true,
  ]);
  if (!p || !c || !m) throw new Error("That option no longer exists. Refresh the page.");
}

const describe = (e: { date: string; cashIn: number; cashOut: number }) =>
  `${e.date} ${e.cashIn > 0 ? `in ${formatMoney(e.cashIn)}` : `out ${formatMoney(e.cashOut)}`}`;

export async function createLedgerEntry(input: Omit<LedgerDTO, "id">): Promise<LedgerDTO> {
  const user = await requireAccess("ledger", "edit");
  const entry = {
    date: clean(input.date, 10),
    cashIn: input.cashIn,
    cashOut: input.cashOut,
    partyId: input.partyId || null,
    categoryId: input.categoryId || null,
    methodId: input.methodId || null,
    comments: clean(input.comments, 1000),
  };
  const error = ledgerEntryError(entry);
  if (error) throw new Error(error);
  await checkRefs(entry);
  const row = await db.ledgerEntry.create({ data: { ...entry, createdById: user.id } });
  await audit(user.email, "ledger.add", `${row.id}: ${describe(row)}`);
  revalidatePath("/ledger", "layout");
  return toLedgerDTO(row);
}

export async function updateLedgerEntry(id: string, patch: LedgerPatch): Promise<LedgerDTO> {
  const user = await requireAccess("ledger", "edit");
  const existing = await db.ledgerEntry.findUnique({ where: { id } });
  if (!existing) throw new Error("Entry not found.");
  const next = {
    date: patch.date !== undefined ? clean(patch.date, 10) : existing.date,
    cashIn: patch.cashIn ?? existing.cashIn,
    cashOut: patch.cashOut ?? existing.cashOut,
    partyId: patch.partyId !== undefined ? patch.partyId || null : existing.partyId,
    categoryId: patch.categoryId !== undefined ? patch.categoryId || null : existing.categoryId,
    methodId: patch.methodId !== undefined ? patch.methodId || null : existing.methodId,
    comments: patch.comments !== undefined ? clean(patch.comments, 1000) : existing.comments,
  };
  const error = ledgerEntryError(next);
  if (error) throw new Error(error);
  await checkRefs(next);
  const row = await db.ledgerEntry.update({ where: { id }, data: next });
  await audit(user.email, "ledger.edit", `${id}: ${describe(existing)} -> ${describe(row)}`);
  revalidatePath("/ledger", "layout");
  return toLedgerDTO(row);
}

export async function deleteLedgerEntry(id: string): Promise<void> {
  const user = await requireAccess("ledger", "edit");
  const existing = await db.ledgerEntry.findUnique({ where: { id } });
  if (!existing) return;
  await db.ledgerEntry.delete({ where: { id } });
  // The audit log keeps what was removed (date and amount only).
  await audit(user.email, "ledger.delete", `${id}: ${describe(existing)}`);
  revalidatePath("/ledger", "layout");
}

export async function listLedger(filters: LedgerFilters): Promise<LedgerDTO[]> {
  await requireAccess("ledger", "view");
  return queryLedger(filters);
}

// ---- Options (categories, methods, "transaction by" names) ----

function model(kind: OptionKind) {
  return kind === "category" ? db.ledgerCategory : kind === "method" ? db.ledgerMethod : db.ledgerParty;
}

export async function addLedgerOption(kind: OptionKind, rawName: string): Promise<{ id: string; name: string }> {
  const user = await requireAccess("ledger", "edit");
  const name = clean(rawName, 80);
  if (!name) throw new Error("Enter a name.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = model(kind) as any;
  if (await m.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) throw new Error("That already exists.");
  const row = await m.create({ data: { name, sortOrder: await m.count() } });
  await audit(user.email, `ledger.${kind}.add`, name);
  revalidatePath("/ledger", "layout");
  return { id: row.id, name: row.name };
}

export async function renameLedgerOption(kind: OptionKind, id: string, rawName: string): Promise<void> {
  const user = await requireAccess("ledger", "edit");
  const name = clean(rawName, 80);
  if (!name) throw new Error("Name can't be blank.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = model(kind) as any;
  const clash = await m.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: { id } } });
  if (clash) throw new Error("That already exists.");
  await m.update({ where: { id }, data: { name } });
  await audit(user.email, `ledger.${kind}.rename`, id);
  revalidatePath("/ledger", "layout");
}

/** Deleting an option keeps the entries; they just lose that label (SET NULL). */
export async function deleteLedgerOption(kind: OptionKind, id: string): Promise<void> {
  const user = await requireAccess("ledger", "edit");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (model(kind) as any).delete({ where: { id } }).catch(() => undefined);
  await audit(user.email, `ledger.${kind}.delete`, id);
  revalidatePath("/ledger", "layout");
}
