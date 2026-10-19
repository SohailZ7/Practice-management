import { describe, expect, it } from "vitest";
import { normalizeIcd10, parseIcd10List } from "../src/lib/billing/icd10";
import { validateEncounter, validateMrn, validatePatient, todayInPractice } from "../src/lib/billing/validate";
import { canChangeEncounter, getixBlocker } from "../src/lib/billing/rules";

// All names and codes are synthetic.
const TODAY = "2026-10-17";
const good = { encounterDate: "2026-10-10", programId: "p1", icd10Input: "e119, I10", chargeCode: "99213", note: "" };

describe("ICD-10 parsing", () => {
  it("normalizes and orders codes, dropping repeats", () => {
    expect(normalizeIcd10("e119")).toBe("E11.9");
    expect(normalizeIcd10("i10")).toBe("I10");
    expect(parseIcd10List("e119, I10; E11.9 f32.a").codes).toEqual(["E11.9", "I10", "F32.A"]);
  });
  it("reports pieces that are not shaped like a code", () => {
    expect(parseIcd10List("I10 banana 123").invalid).toEqual(["banana", "123"]);
  });
});

describe("validateEncounter", () => {
  it("accepts a good encounter and returns normalized values", () => {
    const { values, errors } = validateEncounter(good, ["p1"], TODAY);
    expect(errors).toEqual({});
    expect(values.icd10Codes).toEqual(["E11.9", "I10"]);
  });
  it("rejects future and impossible dates", () => {
    expect(validateEncounter({ ...good, encounterDate: "2026-10-18" }, ["p1"], TODAY).errors.encounterDate).toMatch(/future/);
    expect(validateEncounter({ ...good, encounterDate: "2026-02-30" }, ["p1"], TODAY).errors.encounterDate).toMatch(/real date/);
  });
  it("requires an allowed program, a code, and a charge code or note", () => {
    expect(validateEncounter({ ...good, programId: "zzz" }, ["p1"], TODAY).errors.programId).toBeTruthy();
    expect(validateEncounter({ ...good, icd10Input: "" }, ["p1"], TODAY).errors.icd10Codes).toBeTruthy();
    expect(validateEncounter({ ...good, chargeCode: "", note: "" }, ["p1"], TODAY).errors.chargeCode).toBeTruthy();
    expect(validateEncounter({ ...good, chargeCode: "", note: "see chart" }, ["p1"], TODAY).errors).toEqual({});
  });
  it("limits the number of codes", () => {
    const many = Array.from({ length: 26 }, (_, i) => `A0${i % 10}.${i % 10}`).map((c, i) => `B${10 + i}.1`).join(" ");
    expect(validateEncounter({ ...good, icd10Input: many }, ["p1"], TODAY).errors.icd10Codes).toMatch(/25/);
  });
});

describe("validatePatient / validateMrn", () => {
  it("allows a missing MRN but not a malformed one", () => {
    expect(validatePatient({ lastName: "Doe", firstName: "Jo" }).errors).toEqual({});
    expect(validatePatient({ mrn: "bad mrn!", lastName: "Doe", firstName: "Jo" }).errors.mrn).toBeTruthy();
    expect(validatePatient({ mrn: "ab 12", lastName: "Doe", firstName: "Jo" }).values.mrn).toBe("AB12");
  });
  it("requires names with sensible characters", () => {
    expect(validatePatient({ lastName: "", firstName: "Jo" }).errors.lastName).toBeTruthy();
    expect(validatePatient({ lastName: "O'Brien-Smith", firstName: "Mary Ann" }).errors).toEqual({});
    expect(validatePatient({ lastName: "Doe1", firstName: "Jo" }).errors.lastName).toBeTruthy();
  });
  it("validateMrn requires a value", () => {
    expect(validateMrn("").error).toBeTruthy();
    expect(validateMrn(" ab-12 ").mrn).toBe("AB-12");
  });
});

describe("today in the practice's time zone", () => {
  it("uses the zone, not the server's", () => {
    const instant = new Date("2026-10-18T03:00:00Z"); // still Oct 17 evening in Los Angeles
    expect(todayInPractice(instant, "America/Los_Angeles")).toBe("2026-10-17");
    expect(todayInPractice(instant, "UTC")).toBe("2026-10-18");
  });
});

describe("canChangeEncounter", () => {
  const enc = { createdById: "u1", getixEntered: false, deletedAt: null };
  it("lets the author change their own open encounter", () => {
    expect(canChangeEncounter({ id: "u1", role: "PROVIDER" }, enc)).toBe(true);
  });
  it("does not let a colleague change it, even though they can see it", () => {
    expect(canChangeEncounter({ id: "u2", role: "PROVIDER" }, enc)).toBe(false);
  });
  it("lets an admin change anyone's open encounter", () => {
    expect(canChangeEncounter({ id: "a", role: "ADMIN" }, enc)).toBe(true);
  });
  it("locks encounters marked as entered into GetIX, for everyone including admins", () => {
    const locked = { ...enc, getixEntered: true };
    expect(canChangeEncounter({ id: "u1", role: "PROVIDER" }, locked)).toBe(false);
    expect(canChangeEncounter({ id: "a", role: "ADMIN" }, locked)).toBe(false);
  });
  it("does not allow changing a deleted encounter", () => {
    expect(canChangeEncounter({ id: "a", role: "ADMIN" }, { ...enc, deletedAt: new Date() })).toBe(false);
  });
});

describe("getixBlocker", () => {
  it("needs an MRN and a live encounter", () => {
    expect(getixBlocker({ mrn: null }, { deletedAt: null, getixEntered: false })).toMatch(/MRN/);
    expect(getixBlocker({ mrn: "A1" }, { deletedAt: new Date(), getixEntered: false })).toMatch(/deleted/i);
    expect(getixBlocker({ mrn: "A1" }, { deletedAt: null, getixEntered: false })).toBeNull();
  });
});

import { editableMoney, formatMoney, parseMoney } from "../src/lib/ledger/money";
import { csvField, ledgerEntryError, ledgerTotals } from "../src/lib/ledger/validate";
import { byCategory, byMonth } from "../src/lib/ledger/summary";

describe("ledger money", () => {
  it("parses typed amounts into exact cents", () => {
    expect(parseMoney("$1,000.00")).toEqual({ cents: 100000 });
    expect(parseMoney("12.5")).toEqual({ cents: 1250 });
    expect(parseMoney("0.07")).toEqual({ cents: 7 });
    expect(parseMoney("-")).toEqual({ cents: 0 });
    expect(parseMoney("")).toEqual({ cents: 0 });
  });
  it("rejects things that aren't amounts", () => {
    expect("error" in parseMoney("abc")).toBe(true);
    expect("error" in parseMoney("-5")).toBe(true);
    expect("error" in parseMoney("1.234")).toBe(true);
    expect("error" in parseMoney("99999999999999")).toBe(true);
  });
  it("formats cents back", () => {
    expect(formatMoney(100000)).toBe("$1,000.00");
    expect(formatMoney(7)).toBe("$0.07");
    expect(formatMoney(-1250)).toBe("-$12.50");
    expect(editableMoney(0)).toBe("");
  });
});

describe("ledgerEntryError", () => {
  const ok = { date: "2026-05-06", cashIn: 0, cashOut: 64700 };
  it("accepts one-sided entries", () => {
    expect(ledgerEntryError(ok)).toBeNull();
    expect(ledgerEntryError({ ...ok, cashIn: 100, cashOut: 0 })).toBeNull();
  });
  it("needs a real date and exactly one positive amount", () => {
    expect(ledgerEntryError({ ...ok, date: "2026-02-30" })).toMatch(/date/);
    expect(ledgerEntryError({ ...ok, cashOut: 0 })).toMatch(/amount/);
    expect(ledgerEntryError({ ...ok, cashIn: 5 })).toMatch(/not both/);
    expect(ledgerEntryError({ ...ok, cashOut: -1 })).toMatch(/Amounts/);
    expect(ledgerEntryError({ ...ok, cashOut: 1.5 })).toMatch(/Amounts/);
  });
});

describe("ledger totals and summaries", () => {
  const rows = [
    { date: "2026-05-01", cashIn: 100000, cashOut: 0, categoryId: "dep" },
    { date: "2026-05-06", cashIn: 0, cashOut: 64700, categoryId: "ins" },
    { date: "2026-06-02", cashIn: 0, cashOut: 610, categoryId: null },
  ];
  it("adds exactly", () => {
    expect(ledgerTotals(rows)).toEqual({ cashIn: 100000, cashOut: 65310, net: 34690, count: 3 });
  });
  it("groups by category (biggest spend first) and month (oldest first)", () => {
    expect(byCategory(rows).map((b) => b.key)).toEqual(["ins", "", "dep"]);
    expect(byMonth(rows).map((b) => [b.key, b.net])).toEqual([["2026-05", 35300], ["2026-06", -610]]);
  });
});

describe("csvField", () => {
  it("quotes fields and defuses spreadsheet formulas", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("plain")).toBe("plain");
  });
});
