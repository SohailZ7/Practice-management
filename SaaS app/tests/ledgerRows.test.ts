// Add / edit / delete of a ledger row, through the page actions and through the Claude ledger API. Sohail (2026-11-20)
// removed the approval workflow: every row is final immediately, nothing is Pending, locked or hidden, and rows that still
// carry old approval data (approvalStatus pending / approved / rejected) behave like any other row. Runs under vitest.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const s = vi.hoisted(() => ({ entries: [] as any[], audits: [] as string[], lastCreate: null as any, lastUpdate: null as any }));
vi.mock("../src/lib/db", () => {
  const ok = (id: string) => ({ findUnique: async ({ where }: any) => (where.id === id ? { id, name: id } : null), findFirst: async () => null });
  return {
    db: {
      ledgerCategory: ok("c1"), ledgerParty: ok("p1"), ledgerMethod: ok("m1"),
      ledgerEntry: {
        findFirst: async () => null,
        findUnique: async ({ where }: any) => s.entries.find((x) => x.id === where.id) ?? null,
        findMany: async () => s.entries,
        create: async ({ data }: any) => { s.lastCreate = data; const e = { id: "e" + (s.entries.length + 1), approvalStatus: "approved", approvalNote: "", ...data }; s.entries.push(e); return e; },
        update: async ({ where, data }: any) => { s.lastUpdate = data; const e = s.entries.find((x) => x.id === where.id); Object.assign(e, data); return e; },
        delete: async ({ where }: any) => { s.entries = s.entries.filter((x) => x.id !== where.id); },
      },
      timesheetPayment: { findUnique: async () => null, findMany: async () => [] },
    },
  };
});
vi.mock("../src/lib/audit", () => ({ audit: async (_a: string, action: string) => { s.audits.push(action); } }));
vi.mock("../src/lib/session", () => ({ requireAccess: async () => ({ id: "u1", email: "a@example.org", ledgerApprover: false }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const actions = await import("../src/app/ledger/actions");
const svc = await import("../src/lib/mcpApi/ledgerService");
const user: any = { id: "u1", email: "a@example.org" };
const legacy = (status: string, over: any = {}) => ({ id: "old", date: "2026-11-01", cashIn: 0, cashOut: 5000, partyId: "p1", categoryId: "c1", methodId: "m1", comments: "old", approvalStatus: status, approvalNote: "", ...over });

beforeEach(() => { s.entries = []; s.audits = []; s.lastCreate = null; s.lastUpdate = null; });

describe("ledger rows: add / edit / delete (page actions)", () => {
  const input = { date: "2026-11-17", cashIn: 0, cashOut: 2500, partyId: "p1", categoryId: "c1", methodId: "m1", comments: "Letterheads" };

  it("adds an expense as a final row: no Pending, no approval fields written", async () => {
    const dto: any = await actions.createLedgerEntry(input);
    expect(dto).toMatchObject({ date: "2026-11-17", cashOut: 2500, comments: "Letterheads" });
    expect(dto).not.toHaveProperty("approval");
    expect(s.lastCreate).not.toHaveProperty("approvalStatus");
    expect(s.audits).toEqual(["ledger.add"]);
  });
  it("adds income the same way", async () => {
    await actions.createLedgerEntry({ ...input, cashIn: 900, cashOut: 0 });
    expect(s.entries[0]).toMatchObject({ cashIn: 900, cashOut: 0 });
  });
  it("rejects a bad row (no amount) and writes nothing", async () => {
    await expect(actions.createLedgerEntry({ ...input, cashOut: 0 })).rejects.toThrow();
    expect(s.entries).toHaveLength(0);
  });
  it("edits a row and does not touch approval data", async () => {
    await actions.createLedgerEntry(input);
    const dto = await actions.updateLedgerEntry("e1", { comments: "Letterheads x2", cashOut: 3000 });
    expect(dto).toMatchObject({ comments: "Letterheads x2", cashOut: 3000 });
    expect(Object.keys(s.lastUpdate).sort()).toEqual(["cashIn", "cashOut", "categoryId", "comments", "date", "methodId", "partyId"]);
  });
  it("deletes a row and audits it", async () => {
    await actions.createLedgerEntry(input);
    await actions.deleteLedgerEntry("e1");
    expect(s.entries).toHaveLength(0);
    expect(s.audits).toEqual(["ledger.add", "ledger.delete"]);
  });
  it.each(["pending", "approved", "rejected"])("an old %s expense can be edited and deleted like any other row", async (st) => {
    s.entries = [legacy(st)];
    await expect(actions.updateLedgerEntry("old", { comments: "fixed" })).resolves.toMatchObject({ comments: "fixed" });
    await expect(actions.deleteLedgerEntry("old")).resolves.toBeUndefined();
    expect(s.entries).toHaveLength(0);
  });
  it("old rows are listed as plain rows (nothing hidden)", async () => {
    s.entries = [legacy("pending"), legacy("approved", { id: "o2" }), legacy("rejected", { id: "o3" })];
    expect(await actions.listLedger({ from: "", to: "", categoryId: "", methodId: "", partyId: "", type: "all", q: "" })).toHaveLength(3);
  });
});

describe("ledger rows: add / edit / delete (Claude ledger API)", () => {
  const body = { date: "2026-11-17", cashOut: 2500, memo: "Letterheads" };

  it("create_ledger_entry makes a final row, not Pending", async () => {
    const r: any = await svc.createLedger(user, "t1", body);
    expect(r.entry).not.toHaveProperty("approval");
    expect(s.lastCreate).not.toHaveProperty("approvalStatus");
  });
  it.each(["pending", "approved", "rejected"])("update_ledger_entry edits and deletes an old %s expense (no approved_locked)", async (st) => {
    s.entries = [legacy(st)];
    await expect(svc.updateLedger(user, "t1", "old", { memo: "fixed" })).resolves.toBeTruthy();
    expect(s.lastUpdate).not.toHaveProperty("approvalStatus");
    await expect(svc.deleteLedger(user, "t1", "old")).resolves.toEqual({ deleted: "old" });
  });
});

describe("approval workflow is gone", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("no ledger code path creates Pending, locks, or offers approve/reject", () => {
    for (const f of ["../src/app/ledger/actions.ts", "../src/components/ledger/LedgerGrid.tsx", "../src/lib/mcpApi/ledgerService.ts", "../src/lib/ledger/queries.ts", "../src/app/ledger/page.tsx"]) {
      expect(read(f), f).not.toMatch(/approvalStatus|isLocked|LOCKED_MESSAGE|statusForSave|decideLedgerEntry|canApprove|approved_locked|ledgerApprover/);
    }
  });
  it("the additive columns stay in the schema (no destructive migration)", () => {
    const schema = read("../prisma/schema.prisma");
    expect(schema).toMatch(/approvalStatus\s+String\s+@default\("approved"\)/);
    expect(schema).toMatch(/ledgerApprover\s+Boolean\s+@default\(false\)/);
  });
});
