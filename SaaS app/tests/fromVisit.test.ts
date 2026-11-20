import { describe, it, expect } from "vitest";
import { chargeCodeFor, isBillableStatus } from "@/lib/billing/fromVisit";

describe("Seen to Billing rules", () => {
  it("bills only Seen and Note signed", () => {
    expect(isBillableStatus("seen")).toBe(true);
    expect(isBillableStatus("note_signed")).toBe(true);
    for (const s of ["scheduled", "no_show", "cancelled", "missed", "other"]) expect(isBillableStatus(s)).toBe(false);
  });
  it("maps appointment type to the charge code", () => {
    expect(chargeCodeFor("Psych Eval")).toBe("99203");
    expect(chargeCodeFor("Psych Eval & Admit Order")).toBe("99203");
    expect(chargeCodeFor("Follow-up")).toBe("99213");
    expect(chargeCodeFor("FollowUp + Discharge")).toBe("99238");
    expect(chargeCodeFor("D/C Orders Only")).toBe("NB DC");
    expect(chargeCodeFor("Admit Orders Only")).toBe("");
    expect(chargeCodeFor("")).toBe("");
  });
});
