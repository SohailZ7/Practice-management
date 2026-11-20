import { describe, expect, it } from "vitest";
import { nextStep } from "@/components/billing/EncounterReview";

const r = { deleted: false, getixEntered: false, mrn: "123", chargeCode: "99213" };
describe("encounter review: what happens next", () => {
  it("walks the stages in plain words", () => {
    expect(nextStep({ ...r, deleted: true })).toMatch(/deleted/);
    expect(nextStep({ ...r, getixEntered: true })).toMatch(/locked/);
    expect(nextStep({ ...r, mrn: null })).toMatch(/MRN first/);
    expect(nextStep({ ...r, chargeCode: "" })).toMatch(/charge code or a note/);
    expect(nextStep(r)).toMatch(/ready for manual entry/);
  });
});
