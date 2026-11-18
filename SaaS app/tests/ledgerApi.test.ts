import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const s = vi.hoisted(() => ({ entries: [] as any[], linked: new Set<string>(), audits: [] as string[] }));
vi.mock("../src/lib/db", () => {
  const lookup = (list: { id: string; name: string }[]) => ({
    findUnique: async ({ where }: any) => list.find((x) => x.id === where.id) ?? null,
    findFirst: async ({ where }: any) => list.find((x) => x.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null,
  });
  const cats = [{ id: "c1", name: "Supplies" }];
  const parties = [{ id: "p1", name: "Sohail" }];
  const methods = [{ id: "m1", name: "ACH" }];
  const rel = (e: any) => ({ ...e, category: cats.find((c) => c.id === e.categoryId) ?? null, party: parties.find((c) => c.id === e.partyId) ?? null, method: methods.find((c) => c.id === e.methodId) ?? null });
  const m = (e: any, w: any) => Object.entries(w ?? {}).every(([k, v]) => k === "AND" || e[k] === v);
  return {
    db: {
      ledgerCategory: lookup(cats), ledgerParty: lookup(parties), ledgerMethod: lookup(methods),
      ledgerEntry: {
        findFirst: async ({ where }: any) => s.entries.find((e) => m(e, where)) ?? null,
        findUnique: async ({ where }: any) => { const e = s.entries.find((x) => x.id === where.id); return e ? rel(e) : null; },
        findMany: async ({ where }: any = {}) => s.entries.filter((e) => m(e, where)).map(rel),
        count: async () => s.entries.length,
        create: async ({ data }: any) => { const e = { id: "e" + (s.entries.length + 1), ...data }; s.entries.push(e); return rel(e); },
        update: async ({ where, data }: any) => { const e = s.entries.find((x) => x.id === where.id); Object.assign(e, data); return rel(e); },
        delete: async ({ where }: any) => { s.entries = s.entries.filter((x) => x.id !== where.id); },
      },
      timesheetPayment: {
        findUnique: async ({ where }: any) => (s.linked.has(where.ledgerEntryId) ? { id: "t" } : null),
        findMany: async () => [...s.linked].map((ledgerEntryId) => ({ ledgerEntryId })),
      },
    },
  };
});
vi.mock("../src/lib/audit", () => ({ audit: async (_a: string, action: string, d: string) => { s.audits.push(`${action} ${d}`); } }));

const svc = await import("../src/lib/mcpApi/ledgerService");
const user: any = { id: "u1", email: "a@example.org" };
const base = { date: "2026-11-17", cashOut: 2500, category: "supplies", party: "Sohail", memo: "Letterheads" };

beforeEach(() => { s.entries = []; s.linked = new Set(); s.audits = []; });

describe("ledger API", () => {
  it("creates by name and audits ids and amounts only", async () => {
    const r = await svc.createLedger(user, "t1", base);
    expect(r.entry).toMatchObject({ category: "Supplies", party: "Sohail", cashOut: 2500, memo: "Letterheads" });
    expect(s.audits.join("\n")).toContain("ledger.add");
    expect(s.audits.join("\n")).not.toContain("Letterheads");
  });
  it("refuses an exact duplicate unless forced", async () => {
    await svc.createLedger(user, "t1", base);
    await expect(svc.createLedger(user, "t1", base)).rejects.toMatchObject({ status: 409, code: "duplicate" });
    await svc.createLedger(user, "t1", { ...base, force: true });
    expect(s.entries).toHaveLength(2);
  });
  it("refuses a memo that looks like patient info, and withholds one already stored", async () => {
    await expect(svc.createLedger(user, "t1", { ...base, memo: "Refund for MRN: 12345678" })).rejects.toMatchObject({ status: 422, code: "phi_blocked" });
    s.entries.push({ id: "old", date: "2026-11-01", cashIn: 100, cashOut: 0, comments: "call 703-555-1234 re visit", createdById: "u" });
    const out = await svc.listLedger(user, "t1", new URLSearchParams("limit=10"));
    expect(out.entries[0].memo).toBe(svc.WITHHELD);
  });
  it("rejects bad input and unknown labels", async () => {
    await expect(svc.createLedger(user, "t", { date: "2026-13-40", cashOut: 100 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createLedger(user, "t", { ...base, cashIn: 100 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createLedger(user, "t", { ...base, category: "Nope" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createLedger(user, "t", { ...base, cashOut: 12.5 })).rejects.toMatchObject({ status: 400 });
  });
  it("will not change or delete a row owned by a timesheet payment", async () => {
    s.entries.push({ id: "L", date: "2026-11-01", cashIn: 0, cashOut: 500, comments: "", createdById: "u" });
    s.linked.add("L");
    await expect(svc.updateLedger(user, "t", "L", { cashOut: 600 })).rejects.toMatchObject({ code: "linked_entry" });
    await expect(svc.deleteLedger(user, "t", "L")).rejects.toMatchObject({ code: "linked_entry" });
  });
  it("updates fields and clears a label with null", async () => {
    const { entry } = await svc.createLedger(user, "t", base);
    const r = await svc.updateLedger(user, "t", entry.id, { cashOut: 3000, category: null });
    expect(r.entry).toMatchObject({ cashOut: 3000, category: null, party: "Sohail" });
  });
  it("summary holds counts and totals only", async () => {
    await svc.createLedger(user, "t", base);
    await svc.createLedger(user, "t", { ...base, date: "2026-11-18", cashOut: 1000 });
    const r = await svc.summarizeLedger(user, "t", new URLSearchParams("groupBy=category"));
    expect(r.total).toEqual({ cashIn: 0, cashOut: 3500, net: -3500, count: 2 });
    expect(JSON.stringify(r)).not.toContain("Letterheads");
    expect(r.groups[0]).toMatchObject({ name: "Supplies", count: 2 });
  });
});

describe("ledger scope", () => {
  it("is a token scope and needs the owner's Ledger access", () => {
    expect(readFileSync("src/lib/mcpApi/tokens.ts", "utf8")).toContain('"ledger"');
    const h = readFileSync("src/lib/mcpApi/http.ts", "utf8");
    expect(h).toContain('need.scope === "ledger" && !canAccess(user, "ledger", need.level)');
    expect(h).toContain("token.scope !== need.scope");
  });
  it("every ledger route asks for the ledger scope", () => {
    for (const f of ["route.ts", "[id]/route.ts", "options/route.ts", "summary/route.ts"]) {
      const t = readFileSync(`src/app/api/mcp/v1/ledger/${f}`, "utf8");
      expect(t.match(/authenticateApi\(/g)?.length).toBe(t.match(/scope: "ledger"/g)?.length);
    }
  });
});
