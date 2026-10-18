import type { LedgerEntry, Prisma } from "@prisma/client";
import { db } from "../db";
import { todayISO } from "../dates";
import type { LedgerDTO, LedgerFilters } from "./types";

export const LEDGER_LIMIT = 1000;

export function toLedgerDTO(e: LedgerEntry): LedgerDTO {
  return {
    id: e.id,
    date: e.date,
    cashIn: e.cashIn,
    cashOut: e.cashOut,
    partyId: e.partyId,
    categoryId: e.categoryId,
    methodId: e.methodId,
    comments: e.comments,
  };
}

/** The page opens on the current year. */
export function defaultLedgerFilters(now = todayISO()): LedgerFilters {
  return { from: `${now.slice(0, 4)}-01-01`, to: "", categoryId: "", methodId: "", partyId: "", type: "all", q: "" };
}

export function ledgerWhere(f: LedgerFilters): Prisma.LedgerEntryWhereInput {
  const and: Prisma.LedgerEntryWhereInput[] = [];
  if (f.from) and.push({ date: { gte: f.from } });
  if (f.to) and.push({ date: { lte: f.to } });
  if (f.categoryId) and.push({ categoryId: f.categoryId === "none" ? null : f.categoryId });
  if (f.methodId) and.push({ methodId: f.methodId === "none" ? null : f.methodId });
  if (f.partyId) and.push({ partyId: f.partyId === "none" ? null : f.partyId });
  if (f.type === "in") and.push({ cashIn: { gt: 0 } });
  if (f.type === "out") and.push({ cashOut: { gt: 0 } });
  if (f.q.trim()) and.push({ comments: { contains: f.q.trim(), mode: "insensitive" } });
  return { AND: and };
}

export async function queryLedger(f: LedgerFilters, limit = LEDGER_LIMIT): Promise<LedgerDTO[]> {
  const rows = await db.ledgerEntry.findMany({
    where: ledgerWhere(f),
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  return rows.map(toLedgerDTO);
}

export async function ledgerOptions() {
  const [categories, methods, parties] = await Promise.all([
    db.ledgerCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.ledgerMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.ledgerParty.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return { categories, methods, parties };
}
