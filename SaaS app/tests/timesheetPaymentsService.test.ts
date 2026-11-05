import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory stand-in for the two tables the payments service touches, to prove the two sides stay in step.
type Led = { id: string; date: string; cashIn: number; cashOut: number; categoryId: string | null; methodId: string | null; comments: string; createdById: string };
type Pay = { id: string; employeeId: string; date: string; amountCents: number; methodId: string | null; note: string; coversMonth: string | null; ledgerEntryId: string | null; createdById: string };
let ledger: Led[];
let pays: Pay[];
let n: number;

vi.mock("../src/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("../src/lib/db", () => {
  const tables = () => ({
    ledgerEntry: {
      create: async ({ data }: { data: Omit<Led, "id"> }) => { const r = { id: `L${++n}`, ...data }; ledger.push(r); return r; },
      findUnique: async ({ where }: { where: { id: string } }) => ledger.find((l) => l.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Led> }) => Object.assign(ledger.find((l) => l.id === where.id)!, data),
      deleteMany: async ({ where }: { where: { id: string } }) => { ledger = ledger.filter((l) => l.id !== where.id); return { count: 1 }; },
    },
    timesheetPayment: {
      create: async ({ data }: { data: Omit<Pay, "id"> }) => { const r = { id: `P${++n}`, ...data }; pays.push(r); return r; },
      findUnique: async ({ where }: { where: { id?: string; ledgerEntryId?: string } }) => {
        const r = pays.find((p) => (where.id ? p.id === where.id : p.ledgerEntryId === where.ledgerEntryId));
        return r ? { ...r, employee: { name: "Muntaha" } } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Pay> }) => Object.assign(pays.find((p) => p.id === where.id)!, data),
      delete: async ({ where }: { where: { id: string } }) => { pays = pays.filter((p) => p.id !== where.id); },
    },
  });
  const t = tables();
  return {
    db: {
      ...t,
      timesheetEmployee: { findUnique: async () => ({ id: "e1", name: "Muntaha" }) },
      ledgerCategory: { findFirst: async () => ({ id: "cat-payroll" }) },
      ledgerMethod: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "m-zelle" ? { id: "m-zelle" } : null) },
      $transaction: async (fn: (tx: typeof t) => unknown) => fn(t),
    },
  };
});

const actor = { id: "admin", email: "admin@example.com" };
const p = { date: "2026-10-04", amountCents: 50000, coversMonth: "2026-09", note: "ref 1" };

beforeEach(() => { ledger = []; pays = []; n = 0; });

describe("payment and ledger stay in step", () => {
  it("adding a payment writes exactly one Payroll cash-out in the Ledger and links them", async () => {
    const { addPayment } = await import("../src/lib/timesheets/payments");
    const row = await addPayment(actor, "e1", p, "m-zelle");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ date: "2026-10-04", cashIn: 0, cashOut: 50000, categoryId: "cat-payroll", methodId: "m-zelle" });
    expect(ledger[0].comments).toContain("Muntaha");
    expect(row.ledgerEntryId).toBe(ledger[0].id);
  });
  it("editing the payment updates the same Ledger row, never adds another", async () => {
    const { addPayment, editPayment } = await import("../src/lib/timesheets/payments");
    const row = await addPayment(actor, "e1", p, null);
    await editPayment(actor, row.id, { ...p, amountCents: 20980, date: "2026-10-05" }, "m-zelle");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ date: "2026-10-05", cashOut: 20980, methodId: "m-zelle" });
    expect(pays[0].amountCents).toBe(20980);
  });
  it("deleting the payment removes its Ledger row", async () => {
    const { addPayment, removePayment } = await import("../src/lib/timesheets/payments");
    const row = await addPayment(actor, "e1", p, null);
    await removePayment(actor, row.id);
    expect(pays).toHaveLength(0);
    expect(ledger).toHaveLength(0);
  });
  it("the Ledger can tell which of its rows belong to a payment", async () => {
    const { addPayment, isLinkedLedgerEntry } = await import("../src/lib/timesheets/payments");
    await addPayment(actor, "e1", p, null);
    expect(await isLinkedLedgerEntry(ledger[0].id)).toBe(true);
    expect(await isLinkedLedgerEntry("other")).toBe(false);
  });
  it("an invalid payment writes nothing", async () => {
    const { addPayment, PaymentError } = await import("../src/lib/timesheets/payments");
    await expect(addPayment(actor, "e1", { ...p, amountCents: 0 }, null)).rejects.toBeInstanceOf(PaymentError);
    await expect(addPayment(actor, "e1", p, "gone")).rejects.toBeInstanceOf(PaymentError);
    expect(ledger).toHaveLength(0);
    expect(pays).toHaveLength(0);
  });
});
