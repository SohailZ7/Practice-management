import { approvalOf, isLocked, statusForSave } from "../ledger/approval";
// Ledger operations for the MCP API. Reuses the web Ledger's validation (ledger/validate.ts), its linked-entry rule and its
// audit trail. The ledger holds money, categories and short memos, not patient data; free text that looks like patient
// information is still refused on the way in and withheld on the way out. Audit entries hold ids, dates and amounts only.
import { db } from "../db";
import { audit } from "../audit";
import { detectPhi } from "../phiGuard";
import { isISODate } from "../dates";
import { formatMoney } from "../ledger/money";
import { ledgerEntryError, ledgerTotals } from "../ledger/validate";
import { ledgerWhere, ledgerOptions, defaultLedgerFilters } from "../ledger/queries";
import { isLinkedLedgerEntry, LINKED_LEDGER_MESSAGE } from "../timesheets/payments";
import type { LedgerFilters } from "../ledger/types";
import type { CurrentUser } from "../session";
import { ApiError } from "./http";

export const WITHHELD = "[withheld: looks like patient information]";
const MAX_LIST = 200;

const looksLikePhi = (text: string) => detectPhi(text).length > 0;
const describe = (e: { date: string; cashIn: number; cashOut: number }) => `${e.date} ${e.cashIn > 0 ? `in ${formatMoney(e.cashIn)}` : `out ${formatMoney(e.cashOut)}`}`;

type Row = Awaited<ReturnType<typeof db.ledgerEntry.findMany>>[number] & { party?: { name: string } | null; category?: { name: string } | null; method?: { name: string } | null };

export function toLedgerOut(e: Row, linked = false) {
  return {
    id: e.id,
    date: e.date,
    cashIn: e.cashIn,
    cashOut: e.cashOut,
    party: e.party?.name ?? null,
    category: e.category?.name ?? null,
    method: e.method?.name ?? null,
    memo: looksLikePhi(e.comments) ? WITHHELD : e.comments,
    memoWithheld: looksLikePhi(e.comments),
    linkedToTimesheetPayment: linked,
    approval: approvalOf(e.approvalStatus),
  };
}

const include = { party: true, category: true, method: true } as const;

async function refId(kind: "category" | "method" | "party", id: unknown, name: unknown): Promise<string | null | undefined> {
  if (id === null || name === null) return null; // explicit clear
  if (id === undefined && name === undefined) return undefined;
  const m = (kind === "category" ? db.ledgerCategory : kind === "method" ? db.ledgerMethod : db.ledgerParty) as unknown as {
    findUnique: (a: unknown) => Promise<{ id: string } | null>;
    findFirst: (a: unknown) => Promise<{ id: string } | null>;
  };
  const hit = typeof id === "string" && id ? await m.findUnique({ where: { id } }) : typeof name === "string" && name.trim() ? await m.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" } } }) : null;
  if (!hit) throw new ApiError(400, "invalid", { message: `Unknown ${kind}. List the options first; this API does not create new ones.` });
  return hit.id;
}

export function parseFilters(sp: URLSearchParams): { f: LedgerFilters; limit: number } {
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if ((from && !isISODate(from)) || (to && !isISODate(to))) throw new ApiError(400, "invalid", { message: "from and to must be YYYY-MM-DD" });
  const type = sp.get("type");
  const f: LedgerFilters = {
    ...defaultLedgerFilters(),
    from,
    to,
    categoryId: sp.get("categoryId") ?? "",
    methodId: sp.get("methodId") ?? "",
    partyId: sp.get("partyId") ?? "",
    type: type === "in" || type === "out" ? type : "all",
    q: "",
  };
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), MAX_LIST);
  return { f, limit };
}

/** Category/party given by name in the query are resolved to ids so a caller need not look ids up first. */
async function resolveNames(sp: URLSearchParams, f: LedgerFilters) {
  for (const [kind, key] of [["category", "categoryId"], ["party", "partyId"], ["method", "methodId"]] as const) {
    const name = sp.get(kind);
    if (name && !f[key]) {
      const id = await refId(kind, undefined, name);
      f[key] = id ?? "";
    }
  }
}

export async function listLedger(user: CurrentUser, tokenId: string, sp: URLSearchParams) {
  const { f, limit } = parseFilters(sp);
  await resolveNames(sp, f);
  const rows = await db.ledgerEntry.findMany({ where: ledgerWhere(f), include, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: limit });
  const total = await db.ledgerEntry.count({ where: ledgerWhere(f) });
  const linked = new Set((await db.timesheetPayment.findMany({ where: { ledgerEntryId: { in: rows.map((r) => r.id) } }, select: { ledgerEntryId: true } })).map((p) => p.ledgerEntryId));
  await audit(user.email, "mcp.ledger.list", `token ${tokenId} count=${rows.length}`);
  return { entries: rows.map((r) => toLedgerOut(r, linked.has(r.id))), returned: rows.length, matching: total };
}

export async function getLedger(user: CurrentUser, tokenId: string, id: string) {
  const row = await db.ledgerEntry.findUnique({ where: { id }, include });
  if (!row) throw new ApiError(404, "not_found");
  await audit(user.email, "mcp.ledger.get", `token ${tokenId} entry ${id}`);
  return { entry: toLedgerOut(row, await isLinkedLedgerEntry(id)) };
}

export async function ledgerOptionsOut(user: CurrentUser, tokenId: string) {
  await audit(user.email, "mcp.ledger.options", `token ${tokenId}`);
  return ledgerOptions();
}

type Body = Record<string, unknown>;
const cents = (v: unknown, label: string): number | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new ApiError(400, "invalid", { message: `${label} must be whole cents (an integer)` });
  return v;
};
const memoOf = (v: unknown): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ApiError(400, "invalid", { message: "memo must be text" });
  return v.trim().slice(0, 1000);
};

function refuseIfPhi(user: CurrentUser, text: string | undefined, entryId: string) {
  if (!text) return;
  const found = detectPhi(text);
  if (found.length) {
    const kinds = found.map((f) => f.kind);
    void audit(user.email, "mcp.ledger.phi_blocked", `${entryId}: ${kinds.join(",")}`);
    throw new ApiError(422, "phi_blocked", { message: "The memo looks like it holds patient information. Remove it; the ledger is not for patient data.", kinds });
  }
}

export async function createLedger(user: CurrentUser, tokenId: string, body: Body) {
  const entry = {
    date: typeof body.date === "string" ? body.date.trim().slice(0, 10) : "",
    cashIn: cents(body.cashIn, "cashIn") ?? 0,
    cashOut: cents(body.cashOut, "cashOut") ?? 0,
    comments: memoOf(body.memo) ?? "",
  };
  const error = ledgerEntryError(entry);
  if (error) throw new ApiError(400, "invalid", { message: error });
  refuseIfPhi(user, entry.comments, "new");
  const partyId = (await refId("party", body.partyId, body.party)) ?? null;
  const categoryId = (await refId("category", body.categoryId, body.category)) ?? null;
  const methodId = (await refId("method", body.methodId, body.method)) ?? null;
  // A retry must not double-enter: an exact duplicate is refused unless the caller says it is intentional.
  if (body.force !== true) {
    const dup = await db.ledgerEntry.findFirst({ where: { date: entry.date, cashIn: entry.cashIn, cashOut: entry.cashOut, partyId, categoryId, comments: entry.comments }, select: { id: true } });
    if (dup) throw new ApiError(409, "duplicate", { message: "An identical entry (same date, amount, party, category and memo) already exists. Pass force=true only if this is a genuine second one.", existingId: dup.id });
  }
  const row = await db.ledgerEntry.create({ data: { ...entry, partyId, categoryId, methodId, approvalStatus: statusForSave(entry.cashOut), createdById: user.id }, include });
  await audit(user.email, "ledger.add", `${row.id}: ${describe(row)} via mcp token ${tokenId}`);
  return { entry: toLedgerOut(row) };
}

export async function updateLedger(user: CurrentUser, tokenId: string, id: string, body: Body) {
  const existing = await db.ledgerEntry.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found");
  if (await isLinkedLedgerEntry(id)) throw new ApiError(409, "linked_entry", { message: LINKED_LEDGER_MESSAGE });
  if (isLocked(approvalOf(existing.approvalStatus)) && existing.cashOut > 0) throw new ApiError(409, "approved_locked", { message: "This expense is approved and locked." });
  const memo = memoOf(body.memo);
  if (memo !== undefined && memo !== existing.comments) refuseIfPhi(user, memo, id);
  const next = {
    date: body.date !== undefined ? String(body.date).trim().slice(0, 10) : existing.date,
    cashIn: cents(body.cashIn, "cashIn") ?? existing.cashIn,
    cashOut: cents(body.cashOut, "cashOut") ?? existing.cashOut,
    comments: memo ?? existing.comments,
    partyId: (await refId("party", body.partyId, body.party)) ?? existing.partyId,
    categoryId: (await refId("category", body.categoryId, body.category)) ?? existing.categoryId,
    methodId: (await refId("method", body.methodId, body.method)) ?? existing.methodId,
  };
  // An explicit null clears a label; refId returns null for that and `??` would keep the old one.
  if (body.partyId === null || body.party === null) next.partyId = null;
  if (body.categoryId === null || body.category === null) next.categoryId = null;
  if (body.methodId === null || body.method === null) next.methodId = null;
  const error = ledgerEntryError(next);
  if (error) throw new ApiError(400, "invalid", { message: error });
  const row = await db.ledgerEntry.update({ where: { id }, data: { ...next, approvalStatus: statusForSave(next.cashOut, approvalOf(existing.approvalStatus)) }, include });
  await audit(user.email, "ledger.edit", `${id}: ${describe(existing)} -> ${describe(row)} via mcp token ${tokenId}`);
  return { entry: toLedgerOut(row) };
}

export async function deleteLedger(user: CurrentUser, tokenId: string, id: string) {
  const existing = await db.ledgerEntry.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "not_found");
  if (await isLinkedLedgerEntry(id)) throw new ApiError(409, "linked_entry", { message: LINKED_LEDGER_MESSAGE });
  if (isLocked(approvalOf(existing.approvalStatus)) && existing.cashOut > 0) throw new ApiError(409, "approved_locked", { message: "This expense is approved and locked." });
  await db.ledgerEntry.delete({ where: { id } });
  await audit(user.email, "ledger.delete", `${id}: ${describe(existing)} via mcp token ${tokenId}`);
  return { deleted: id };
}

/** Counts and totals only, overall and grouped (category | party | method | month). No memos, no entry ids. */
export async function summarizeLedger(user: CurrentUser, tokenId: string, sp: URLSearchParams) {
  const { f } = parseFilters(sp);
  await resolveNames(sp, f);
  const by = sp.get("groupBy") ?? "";
  if (by && !["category", "party", "method", "month"].includes(by)) throw new ApiError(400, "invalid", { message: "groupBy must be category, party, method or month" });
  const rows = await db.ledgerEntry.findMany({ where: ledgerWhere(f), include, take: 20_000 });
  const groups = new Map<string, { cashIn: number; cashOut: number }[]>();
  if (by) {
    for (const r of rows) {
      const key = by === "month" ? r.date.slice(0, 7) : (by === "category" ? r.category?.name : by === "party" ? r.party?.name : r.method?.name) ?? "(none)";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
  }
  await audit(user.email, "mcp.ledger.summary", `token ${tokenId} rows=${rows.length} by=${by || "none"}`);
  return {
    range: { from: f.from || null, to: f.to || null },
    total: ledgerTotals(rows),
    groups: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, rs]) => ({ name, ...ledgerTotals(rs) })),
  };
}
