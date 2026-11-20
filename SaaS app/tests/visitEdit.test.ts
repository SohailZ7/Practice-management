import { describe, expect, it } from "vitest";
import { providerChangeError, splitPatch } from "../src/lib/notes/visitEdit";

describe("splitPatch", () => {
  it("lets providers and admins apply everything now", () => {
    expect(splitPatch("PROVIDER", { apptTime: "2:00 PM", status: "seen" })).toEqual({ now: { apptTime: "2:00 PM", status: "seen" }, needsApproval: {} });
    expect(splitPatch("ADMIN", { program: "X" }).needsApproval).toEqual({});
  });
  it("sends staff time, program and type for approval but applies status now", () => {
    const r = splitPatch("STAFF", { apptTime: "3:00 PM", program: "P", appointmentType: "Follow-up", status: "seen" });
    expect(r.now).toEqual({ status: "seen" });
    expect(r.needsApproval).toEqual({ apptTime: "3:00 PM", program: "P", appointmentType: "Follow-up" });
  });
});

describe("providerChangeError", () => {
  it("admin may assign anyone; staff may not", () => {
    expect(providerChangeError("ADMIN", null, "A", "B")).toBeNull();
    expect(providerChangeError("STAFF", null, "", "B")).toMatch(/provider or admin/);
  });
  it("a provider may claim for themselves or release their own, not assign another", () => {
    expect(providerChangeError("PROVIDER", "Dr. Me", "Dr. Other", "dr. me")).toBeNull();
    expect(providerChangeError("PROVIDER", "Dr. Me", "Dr. Me", "")).toBeNull();
    expect(providerChangeError("PROVIDER", "Dr. Me", "", "Dr. Other")).toMatch(/only an admin/);
    expect(providerChangeError("PROVIDER", "Dr. Me", "Dr. Other", "")).toMatch(/only an admin/);
    expect(providerChangeError("PROVIDER", null, "", "Dr. Me")).toMatch(/not linked/);
  });
});
