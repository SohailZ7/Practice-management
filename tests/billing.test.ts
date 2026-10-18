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
