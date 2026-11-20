import { describe, it, expect } from "vitest";
import { cleanBasics } from "../src/lib/patients/chart";
import { COMMON_ICD10, addIcd10, searchCommonIcd10 } from "../src/lib/billing/icd10Common";
import { parseIcd10List } from "../src/lib/billing/icd10";
import { docStateLabel } from "../src/lib/patients/docState";

describe("chart fields: account number and allergies", () => {
  it("saves them trimmed, the account number upper-cased without spaces, and empty becomes null", () => {
    const r = cleanBasics({ accountNo: " ab 123 ", allergies: "  Penicillin,  latex " }, "2026-11-20");
    expect(r).toMatchObject({ ok: true, value: { accountNo: "AB123", allergies: "Penicillin, latex" } });
    expect(cleanBasics({ accountNo: "", allergies: " " }, "2026-11-20")).toMatchObject({ ok: true, value: { accountNo: null, allergies: null } });
  });
  it("keeps B&B MRN and FFX MRN as separate values", () => {
    expect(cleanBasics({ mrn: "bb 1", ffxMrn: "ffx 9" }, "2026-11-20")).toMatchObject({ ok: true, value: { mrn: "BB1", ffxMrn: "FFX9" } });
  });
  it("caps allergies at 500 characters", () => {
    const r = cleanBasics({ allergies: "x".repeat(900) }, "2026-11-20");
    expect(r.ok && r.value.allergies?.length).toBe(500);
  });
});

describe("ICD-10 starter list", () => {
  it("has 20 distinct, well-formed codes", () => {
    expect(COMMON_ICD10).toHaveLength(20);
    expect(new Set(COMMON_ICD10.map((e) => e.code)).size).toBe(20);
    for (const e of COMMON_ICD10) expect(parseIcd10List(e.code)).toEqual({ codes: [e.code], invalid: [] });
  });
  it("searches by code prefix or any word of the name", () => {
    expect(searchCommonIcd10("f41").map((e) => e.code)).toEqual(["F41.1", "F41.9", "F41.0"]);
    expect(searchCommonIcd10("bipolar").map((e) => e.code)).toEqual(["F31.9", "F31.81"]);
    expect(searchCommonIcd10("")).toHaveLength(20);
    expect(searchCommonIcd10("zzz")).toEqual([]);
  });
  it("adds a picked code once, after what is typed", () => {
    expect(addIcd10("", "F41.1")).toBe("F41.1");
    expect(addIcd10("E11.9", "F41.1")).toBe("E11.9, F41.1");
    expect(addIcd10("E11.9, f41.1", "F41.1")).toBe("E11.9, f41.1");
    expect(addIcd10("E11.9,", "F32.A")).toBe("E11.9, F32.A");
  });
});

describe("approved documents in the chart", () => {
  it("shows draft, or Approved with the date", () => {
    expect(docStateLabel({ draft: true, finalizedAt: null })).toBe(" (draft)");
    expect(docStateLabel({ draft: false, finalizedAt: new Date("2026-11-05T15:00:00Z") })).toBe(" (Approved 2026-11-05)");
    expect(docStateLabel({ draft: false, finalizedAt: null })).toBe(" (Approved)");
  });
});
