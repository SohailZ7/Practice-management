import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { approvalOf, canApprove, isLocked, statusForSave } from "../src/lib/ledger/approval";

describe("ledger expense approval", () => {
  it("every expense starts pending; income does not wait", () => {
    expect(statusForSave(500)).toBe("pending");
    expect(statusForSave(0)).toBe("approved");
  });
  it("editing a rejected or pending expense sends it back to pending", () => {
    expect(statusForSave(500, "rejected")).toBe("pending");
  });
  it("approved entries lock; unknown stored words read as approved (old rows)", () => {
    expect(isLocked("approved")).toBe(true);
    expect(isLocked("pending")).toBe(false);
    expect(approvalOf(undefined)).toBe("approved");
    expect(approvalOf("pending")).toBe("pending");
  });
  it("only the flagged approver may approve", () => {
    expect(canApprove({ ledgerApprover: true })).toBe(true);
    expect(canApprove({ ledgerApprover: false })).toBe(false);
    expect(canApprove({})).toBe(false);
  });
  it("schema is additive and defaults old rows to approved", () => {
    const s = readFileSync("prisma/schema.prisma", "utf8");
    expect(s).toMatch(/approvalStatus\s+String\s+@default\("approved"\)/);
    expect(s).toMatch(/ledgerApprover\s+Boolean\s+@default\(false\)/);
  });
  it("web and Claude API both enforce the lock and the approval rule", () => {
    const a = readFileSync("src/app/ledger/actions.ts", "utf8");
    expect(a).toContain("statusForSave(entry.cashOut)");
    expect(a).toMatch(/decideLedgerEntry[\s\S]*canApprove\(user\)/);
    expect((a.match(/LOCKED_MESSAGE/g) ?? []).length).toBeGreaterThanOrEqual(3);
    const m = readFileSync("src/lib/mcpApi/ledgerService.ts", "utf8");
    expect(m).toContain("statusForSave(entry.cashOut)");
    expect((m.match(/approved_locked/g) ?? []).length).toBe(2);
  });
});
