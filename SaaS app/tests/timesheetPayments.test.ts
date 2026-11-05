import { describe, expect, it } from "vitest";
import { balances, ledgerComment, paymentError } from "../src/lib/timesheets/calc";
import { entryKey, paymentKey, planImport } from "../src/lib/timesheets/importer";

const row = (id: string, date: string, startMin: number, endMin: number, rateCents: number) => ({ id, date, startMin, endMin, rateCents });

describe("paymentError", () => {
  const ok = { date: "2026-10-04", amountCents: 50000, coversMonth: "2026-09", note: "" };
  it("accepts a normal payment, with or without a month", () => {
    expect(paymentError(ok)).toBeNull();
    expect(paymentError({ ...ok, coversMonth: null })).toBeNull();
  });
  it("rejects bad date, amount, month and long note", () => {
    expect(paymentError({ ...ok, date: "10/04/26" })).toMatch(/date/);
    expect(paymentError({ ...ok, amountCents: 0 })).toMatch(/amount/);
    expect(paymentError({ ...ok, amountCents: -5 })).toMatch(/amount/);
    expect(paymentError({ ...ok, coversMonth: "Sept" })).toMatch(/month/);
    expect(paymentError({ ...ok, note: "x".repeat(301) })).toMatch(/note/);
  });
});

describe("balances", () => {
  const charged = [row("a", "2026-09-10", 600, 660, 3000), row("b", "2026-10-02", 600, 720, 2300)]; // $30.00 and $46.00
  it("month balance counts only payments that cover that month; employee balance counts all", () => {
    const pays = [{ amountCents: 1000, coversMonth: "2026-09" }, { amountCents: 500, coversMonth: null }];
    const b = balances(charged, pays, "2026-09");
    expect(b.month).toEqual({ chargedCents: 3000, paidCents: 1000, balanceCents: 2000 });
    expect(b.employee).toEqual({ chargedCents: 7600, paidCents: 1500, balanceCents: 6100 });
    expect(balances(charged, pays, "2026-10").month).toEqual({ chargedCents: 4600, paidCents: 0, balanceCents: 4600 });
  });
  it("an overpayment is a negative balance", () => {
    expect(balances(charged, [{ amountCents: 9000, coversMonth: null }], "2026-09").employee.balanceCents).toBe(-1400);
  });
});

describe("ledgerComment", () => {
  it("names the employee and month, and adds the note", () => {
    expect(ledgerComment("Muntaha", "2026-09", "Zelle ref 1")).toBe("Timesheet payment: Muntaha for September 2026. Zelle ref 1");
    expect(ledgerComment("Zaid", null, "")).toBe("Timesheet payment: Zaid");
  });
});

describe("planImport", () => {
  const file = {
    employees: [
      {
        name: "Muntaha",
        entries: [
          { date: "2026-10-01", start: "5:27 PM", end: "6:06 PM", rate: "$23.00", sheetMinutes: 39, sheetChargeCents: 1495 },
          { date: "2026-10-02", start: "10:49 PM", end: "11:02 PM", rate: "30", sheetMinutes: 13, sheetChargeCents: 650 },
        ],
        payments: [{ date: "2026-10-04", amountCents: 50000, coversMonth: "2026-09" }],
      },
    ],
  };
  it("computes minutes and charge itself and finds none different when the sheet agrees", () => {
    const p = planImport(file);
    expect(p.errors).toEqual([]);
    expect(p.discrepancies).toEqual([]);
    expect(p.employees[0].entries[0]).toEqual({ date: "2026-10-01", startMin: 1047, endMin: 1086, rateCents: 2300 });
    expect(p.employees[0].payments).toHaveLength(1);
  });
  it("reports a row where the sheet's minutes or charge differ from the computed value", () => {
    const bad = structuredClone(file);
    bad.employees[0].entries[0].sheetMinutes = 40;
    bad.employees[0].entries[1].sheetChargeCents = 700;
    const p = planImport(bad);
    expect(p.discrepancies.map((d) => [d.field, d.computed, d.sheet])).toEqual([["minutes", 39, 40], ["charge", 650, 700]]);
  });
  it("rejects unreadable rows instead of guessing, e.g. a blank date or an overnight shift", () => {
    const p = planImport({ employees: [{ name: "Zaid", entries: [
      { date: "", start: "5:28 PM", end: "6:21 PM", rate: "23" },
      { date: "2026-10-03", start: "11:00 PM", end: "1:00 AM", rate: "23" },
    ] }] });
    expect(p.employees[0].entries).toEqual([]);
    expect(p.errors).toHaveLength(2);
  });
  it("identity keys make a second run skip what is already there", () => {
    const e = { date: "2026-10-01", startMin: 1047, endMin: 1086 };
    expect(entryKey("emp", e)).toBe(entryKey("emp", { ...e }));
    expect(entryKey("emp", e)).not.toBe(entryKey("emp2", e));
    const p = { date: "2026-10-04", amountCents: 50000, coversMonth: "2026-09" };
    expect(paymentKey("emp", p)).toBe(paymentKey("emp", { ...p }));
    expect(paymentKey("emp", p)).not.toBe(paymentKey("emp", { ...p, amountCents: 20980 }));
  });
});
