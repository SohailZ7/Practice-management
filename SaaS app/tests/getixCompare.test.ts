import { describe, expect, it } from "vitest";
import { compareGetix, nameKey, normDate, parseGetixReport } from "../src/lib/billing/getixCompare";

describe("GetIX compare", () => {
  it("reads dates and names in common forms", () => {
    expect(normDate("11/5/2026")).toBe("2026-11-05");
    expect(normDate("2026-11-05 09:00")).toBe("2026-11-05");
    expect(normDate("x")).toBeNull();
    expect(nameKey("Doe, Jane")).toBe(nameKey("jane DOE"));
  });
  it("parses a report with Patient and Service Date, skipping bad rows", () => {
    const r = parseGetixReport('Service Date,Patient,CPT\n11/5/2026,"Doe, Jane",99213\nbad,Someone,1\n11/6/2026,John Roe,99203');
    expect(r.rows.map((x) => [x.date, x.chargeCode])).toEqual([["2026-11-05", "99213"], ["2026-11-06", "99203"]]);
    expect(r.skipped).toBe(1);
  });
  it("accepts first and last name columns and explains a missing column", () => {
    expect(parseGetixReport("Date,First Name,Last Name\n2026-11-05,Jane,Doe").rows[0].key).toBe(nameKey("Jane Doe"));
    expect(parseGetixReport("Foo,Bar\n1,2").error).toMatch(/date column/);
  });
  it("lists what is only in the report, only here, and incorrect rows still in GetIX", () => {
    const rep = parseGetixReport("Date,Patient\n2026-11-05,Jane Doe\n2026-11-05,Sam Lee\n2026-11-06,Bad Bill").rows;
    const enc = [
      { id: "1", date: "2026-11-05", key: nameKey("Doe Jane"), display: "Doe, Jane", chargeCode: "", incorrect: false },
      { id: "2", date: "2026-11-06", key: nameKey("Ann Gone"), display: "Gone, Ann", chargeCode: "", incorrect: false },
      { id: "3", date: "2026-11-06", key: nameKey("Bad Bill"), display: "Bill, Bad", chargeCode: "", incorrect: true },
      { id: "4", date: "2026-12-01", key: nameKey("Out Range"), display: "x", chargeCode: "", incorrect: false },
    ];
    const c = compareGetix(rep, enc);
    expect(c.matched).toBe(1);
    expect(c.onlyInReport.map((r) => r.display)).toEqual(["Sam Lee"]);
    expect(c.onlyInApp.map((e) => e.id)).toEqual(["2"]);
    expect(c.incorrectStillInReport.map((e) => e.id)).toEqual(["3"]);
  });
});
