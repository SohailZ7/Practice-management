import { describe, it, expect } from "vitest";
import { cleanBasics, checkAdmit, checkDischarge } from "@/lib/patients/chart";

describe("chart basics", () => {
  it("normalises MRNs and rejects bad or future dob", () => {
    const r = cleanBasics({ mrn: " ab 12 ", ffxMrn: "f9", dob: "1980-02-03", insurance: " Aetna " }, "2026-11-19");
    expect(r).toEqual({ ok: true, value: { mrn: "AB12", ffxMrn: "F9", dob: "1980-02-03", sex: null, insurance: "Aetna", accountNo: null, allergies: null } });
    expect(cleanBasics({ dob: "1980-13-01" }, "2026-11-19").ok).toBe(false);
    expect(cleanBasics({ dob: "2027-01-01" }, "2026-11-19").ok).toBe(false);
    expect(cleanBasics({}, "2026-11-19")).toMatchObject({ ok: true });
  });
});
describe("admissions", () => {
  it("allows readmission after discharge, not while open", () => {
    expect(checkAdmit([], "2026-11-01")).toBeNull();
    expect(checkAdmit([{ admitDate: "2026-10-01", dischargeDate: null }], "2026-11-01")).toMatch(/already admitted/);
    expect(checkAdmit([{ admitDate: "2026-10-01", dischargeDate: "2026-10-10" }], "2026-11-01")).toBeNull();
    expect(checkAdmit([{ admitDate: "2026-10-01", dischargeDate: "2026-10-10" }], "2026-10-05")).toMatch(/before/);
  });
  it("checks discharge order", () => {
    const s = { admitDate: "2026-10-05", dischargeDate: null };
    expect(checkDischarge(s, "2026-10-04")).toMatch(/before/);
    expect(checkDischarge(s, "2026-10-05")).toBeNull();
    expect(checkDischarge({ ...s, dischargeDate: "2026-10-06" }, "2026-10-07")).toMatch(/already/);
  });
});
