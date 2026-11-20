import { describe, it, expect } from "vitest";
import { stageOf, submitBlocker, verifyBlocker, getixNeedsVerify, incorrectState } from "@/lib/billing/stage";

const base = { submittedAt: null, verifiedAt: null, getixEntered: false, deletedAt: null };
const d = new Date();
describe("billing stage flow", () => {
  it("derives the stage", () => {
    expect(stageOf(base)).toBe("draft");
    expect(stageOf({ ...base, submittedAt: d })).toBe("submitted");
    expect(stageOf({ ...base, submittedAt: d, verifiedAt: d })).toBe("verified");
    expect(stageOf({ ...base, verifiedAt: d, getixEntered: true })).toBe("entered");
  });
  it("lets provider, owner or admin submit; not staff who did not enter it", () => {
    expect(submitBlocker("PROVIDER", false, base)).toBeNull();
    expect(submitBlocker("STAFF", true, base)).toBeNull();
    expect(submitBlocker("STAFF", false, base)).toMatch(/Only a provider/);
    expect(submitBlocker("ADMIN", false, { ...base, verifiedAt: d })).toMatch(/verified/);
  });
  it("only an admin verifies, with a charge code and diagnosis (NB DC needs no diagnosis)", () => {
    const e = { ...base, chargeCode: "99213", icd10Codes: ["F32.9"] };
    expect(verifyBlocker("PROVIDER", e)).toMatch(/admin/);
    expect(verifyBlocker("ADMIN", e)).toBeNull();
    expect(verifyBlocker("ADMIN", { ...e, chargeCode: "" })).toMatch(/charge code/);
    expect(verifyBlocker("ADMIN", { ...e, icd10Codes: [] })).toMatch(/diagnosis/);
    expect(verifyBlocker("ADMIN", { ...e, chargeCode: "NB DC", icd10Codes: [] })).toBeNull();
  });
  it("GetIX needs verification; incorrect bucket states", () => {
    expect(getixNeedsVerify({ verifiedAt: null })).toMatch(/verify/);
    expect(getixNeedsVerify({ verifiedAt: d })).toBeNull();
    expect(incorrectState({ incorrectAt: null, incorrectResolvedAt: null })).toBe("none");
    expect(incorrectState({ incorrectAt: d, incorrectResolvedAt: null })).toBe("open");
    expect(incorrectState({ incorrectAt: d, incorrectResolvedAt: d })).toBe("complete");
  });
});
