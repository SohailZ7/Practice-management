import { describe, expect, it } from "vitest";
import { buildReport, redact, toCsv, type ReportVisit } from "../src/lib/reports/build";

const v = (o: Partial<ReportVisit>): ReportVisit => ({ id: "x", date: "2026-11-05", time: "9:00", status: "seen", program: "KIOP", type: "Follow-up", provider: "Dr A", trackingOnly: false, patientId: "p1", patientName: "Doe, Jane", chargeCode: "99213", billed: false, hasEncounter: true, docCount: 0, docDraft: false, docDoneDate: "", ...o });
const data = [
  v({ id: "1" }),
  v({ id: "2", status: "no_show", patientId: "p2", patientName: "Roe, Sam" }),
  v({ id: "3", billed: true, docCount: 1, type: "Psych Eval", chargeCode: "99203" }),
  v({ id: "4", provider: "Fitsum", trackingOnly: true, patientId: "p3", patientName: "Lee, Ann" }),
  v({ id: "5", status: "scheduled", date: "2026-11-20", patientId: "p2", patientName: "Roe, Sam" }),
];
const today = { today: "2026-11-10" };

describe("reports", () => {
  it("seen vs not seen counts statuses with share", () => {
    const [by] = buildReport("seen", data, today);
    expect(by.rows).toContainEqual(["Seen", 3, "60%"]);
    expect(by.rows).toContainEqual(["Not Seen", 1, "20%"]);
  });
  it("billing and docs list seen visits, never tracking-only", () => {
    const b = buildReport("billing", data, today);
    expect(b[0].rows).toContainEqual(["99213", 1, 0]);
    expect(b[1].rows).toHaveLength(1);
    expect(buildReport("docs", data, today)[0].rows.map((r) => r[0])).toEqual(["2026-11-05"]);
    expect(buildReport("docs", data, today)[0].rows).toHaveLength(1);
  });
  it("patients summary counts upcoming and Not Seen per patient", () => {
    const rows = buildReport("patients", data, today)[0].rows;
    const roe = rows.find((r) => r[0] === "Roe, Sam")!;
    expect(roe.slice(2, 9)).toEqual([2, 0, 0, 1, 0, 0, 1]);
  });
  it("timesheet leaves out tracking-only providers and totals the invoice lines", () => {
    const [inv, sheet] = buildReport("timesheet", data, today);
    expect(inv.rows.at(-1)).toEqual(["Total", "", 2]);
    expect(sheet.rows.every((r) => r[0] === "Dr A")).toBe(true);
  });
  it("redact removes every name column and the CSV guards formulas", () => {
    const red = redact(buildReport("timesheet", data, today));
    expect(JSON.stringify(red)).not.toMatch(/Doe|Roe|Patient/);
    expect(toCsv([{ title: "t", columns: [{ key: "a", label: "A" }], rows: [["=cmd()"], ['a,"b"']] }])).toContain("'=cmd()");
  });
});

import { filterVisits } from "../src/lib/reports/build";
describe("drill-down and trends", () => {
  it("filters visits by the clicked status, provider, type or code", () => {
    expect(filterVisits(data, { s: "Not Seen" }).map((x) => x.id)).toEqual(["2"]);
    expect(filterVisits(data, { p: "fitsum" }).map((x) => x.id)).toEqual(["4"]);
    expect(filterVisits(data, { c: "99203" }).map((x) => x.id)).toEqual(["3"]);
    expect(filterVisits(data, { t: "(none)" })).toEqual([]);
  });
  it("trends group by Monday week and count overdue", () => {
    const t = buildReport("trends", [...data, v({ id: "9", status: "scheduled", date: "2026-10-01" })], { today: "2026-11-10" })[0];
    expect(t.rows[0]).toEqual(["2026-09-28", 1, 0, 0, 0, 1, ""]);
    expect(t.rows.find((r) => r[0] === "2026-11-02")![1]).toBe(4);
  });
});

import { turnaround } from "../src/lib/reports/build";
describe("documentation turnaround", () => {
  it("averages days from visit to final documents over seen visits that have them", () => {
    expect(turnaround([v({ docDoneDate: "2026-11-07" }), v({ docDoneDate: "2026-11-06" }), v({}), v({ status: "no_show", docDoneDate: "2026-11-30" })])).toBe("1.5");
    expect(turnaround([v({})])).toBe("");
  });
});
