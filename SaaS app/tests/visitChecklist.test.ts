import { describe, expect, it } from "vitest";
import { applyToggle, cleanLabel, isChecklistKind, isDischargeType } from "../src/lib/notes/checklist";

describe("visit checklist rules", () => {
  it("only lists items from the fixed lists, in their spelling", () => {
    expect(cleanLabel("order", "lab order")).toBe("Lab Order");
    expect(cleanLabel("order", "Medication")).toBe("Medication");
    expect(cleanLabel("documentation", "Medication")).toBeNull();
    expect(isChecklistKind("order")).toBe(true);
    expect(isChecklistKind("x")).toBe(false);
  });
  it("sent to FFX needs completed, and un-completing clears it", () => {
    expect(applyToggle({ done: false, sentToFfx: false }, "sentToFfx", true)).toEqual({ done: false, sentToFfx: false });
    expect(applyToggle({ done: true, sentToFfx: false }, "sentToFfx", true)).toEqual({ done: true, sentToFfx: true });
    expect(applyToggle({ done: true, sentToFfx: true }, "done", false)).toEqual({ done: false, sentToFfx: false });
  });
  it("shows the Discharged control on discharge appointments", () => {
    expect(isDischargeType("Discharge")).toBe(true);
    expect(isDischargeType("D/C Orders Only")).toBe(true);
    expect(isDischargeType("Follow-up")).toBe(false);
  });
});
