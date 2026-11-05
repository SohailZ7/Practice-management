import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-ins for the tables the import touches, to prove the import is idempotent and mirrors payments to the Ledger.
type Entry = { id: string; employeeId: string; date: string; startMin: number; endMin: number; rateCents: number };
type Pay = { id: string; employeeId: string; date: string; amountCents: number; coversMonth: string | null; ledgerEntryId: string | null; methodId: string | null; note: string };
let entries: Entry[];
let pays: Pay[];
let ledger: { id: string; cashOut: number }[];
let n: number;
const audits: string[] = [];

vi.mock("../src/lib/audit", () => ({ audit: vi.fn(async (_a: string, action: string, detail: string) => { audits.push(`${action} ${detail}`); }) }));
vi.mock("../src/lib/timesheets/queries", () => ({ ensureEmployees: async () => [{ id: "m1", name: "Muntaha" }, { id: "z1", name: "Zaid" }] }));
vi.mock("../src/lib/db", () => {
  const t = {
    timesheetEntry: {
      findMany: async ({ where }: { where: { employeeId: string } }) => entries.filter((e) => e.employeeId === where.employeeId),
      createMany: async ({ data }: { data: Omit<Entry, "id">[] }) => { for (const d of data) entries.push({ id: `E${++n}`, ...d }); },
    },
    timesheetPayment: {
      findMany: async ({ where }: { where: { employeeId: string } }) => pays.filter((p) => p.employeeId === where.employeeId),
      create: async ({ data }: { data: Omit<Pay, "id"> }) => { const r = { id: `P${++n}`, ...data }; pays.push(r); return r; },
    },
    ledgerEntry: { create: async ({ data }: { data: { cashOut: number } }) => { const r = { id: `L${++n}`, ...data }; ledger.push(r); return r; } },
  };
  return {
    db: {
      ...t,
      timesheetEmployee: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id === "m1" ? "Muntaha" : "Zaid" }) },
      ledgerCategory: { findFirst: async () => ({ id: "cat" }) },
      ledgerMethod: { findUnique: async () => null },
      $transaction: async (fn: (tx: typeof t) => unknown) => fn(t),
    },
  };
});

const actor = { id: "admin", email: "a@example.com" };
const file = JSON.stringify({
  employees: [
    {
      name: "Muntaha",
      entries: [
        { date: "2026-10-01", start: "5:27 PM", end: "6:06 PM", rate: "23", sheetMinutes: 39, sheetChargeCents: 1495 },
        { date: "", start: "5:28 PM", end: "6:21 PM", rate: "23", sheetMinutes: 53, sheetChargeCents: 2032 },
      ],
      payments: [{ date: "2026-10-04", amountCents: 50000, coversMonth: "2026-09" }],
    },
    { name: "Zaid", entries: [{ date: "2026-10-26", start: "6:51 PM", end: "7:14 PM", rate: "18" }] },
  ],
});

beforeEach(() => { entries = []; pays = []; ledger = []; n = 0; audits.length = 0; });

describe("timesheet import", () => {
  it("a dry run saves nothing and lists the undated row as needing a date", async () => {
    const { runImport } = await import("../src/lib/timesheets/importService");
    const r = await runImport(actor, file, { apply: false });
    expect(r.applied).toBe(false);
    expect(r.needsDate).toHaveLength(1);
    expect(r.entries.find((e) => e.employee === "Muntaha")).toMatchObject({ month: "2026-10", add: 1, present: 0 });
    expect(entries).toHaveLength(0);
    expect(pays).toHaveLength(0);
    expect(ledger).toHaveLength(0);
  });
  it("refuses to apply while a row still needs a date, and writes nothing", async () => {
    const { runImport } = await import("../src/lib/timesheets/importService");
    const r = await runImport(actor, file, { apply: true });
    expect(r.fatal).toMatch(/date/);
    expect(entries).toHaveLength(0);
  });
  it("applies with the admin's date, adds the payment and its Ledger row, and audits counts only", async () => {
    const { runImport } = await import("../src/lib/timesheets/importService");
    const r = await runImport(actor, file, { apply: true, fixes: [{ employee: "Muntaha", index: 1, date: "2026-11-04" }] });
    expect(r.applied).toBe(true);
    expect(entries).toHaveLength(3);
    expect(pays).toHaveLength(1);
    expect(ledger).toEqual([expect.objectContaining({ cashOut: 50000 })]);
    expect(pays[0].ledgerEntryId).toBe(ledger[0].id);
    const log = audits.find((a) => a.startsWith("timesheet.import"))!;
    expect(log).toBe("timesheet.import entries added 3, payments added 1, skipped by admin 0");
  });
  it("uploading the same file twice adds nothing the second time", async () => {
    const { runImport } = await import("../src/lib/timesheets/importService");
    const fixes = [{ employee: "Muntaha", index: 1, date: "2026-11-04" }];
    await runImport(actor, file, { apply: true, fixes });
    const again = await runImport(actor, file, { apply: true, fixes });
    expect(entries).toHaveLength(3);
    expect(pays).toHaveLength(1);
    expect(ledger).toHaveLength(1);
    expect(again.entries.every((e) => e.add === 0)).toBe(true);
    expect(again.payments.every((p) => p.add === 0)).toBe(true);
  });
  it("a skipped row is counted, not dropped silently", async () => {
    const { runImport } = await import("../src/lib/timesheets/importService");
    const r = await runImport(actor, file, { apply: true, fixes: [{ employee: "Muntaha", index: 1, skip: true }] });
    expect(r.skippedByAdmin).toBe(1);
    expect(entries).toHaveLength(2);
  });
  it("rejects a file that is not a timesheet import", async () => {
    const { runImport } = await import("../src/lib/timesheets/importService");
    expect((await runImport(actor, "not json", { apply: false })).fatal).toMatch(/JSON/);
    expect((await runImport(actor, "{}", { apply: false })).fatal).toMatch(/employees/);
  });
});
