import { describe, it, expect } from "vitest";
import { validateTimeOff, timeOffOn, isIsoDate, formatRange } from "@/lib/schedule/timeOff";

describe("provider time off", () => {
  it("validates dates and order", () => {
    expect(validateTimeOff("2026-12-01", "2026-12-03")).toBeNull();
    expect(validateTimeOff("2026-12-01", "2026-12-01")).toBeNull();
    expect(validateTimeOff("2026-12-03", "2026-12-01")).toMatch(/before/);
    expect(validateTimeOff("", "2026-12-01")).toMatch(/start/);
    expect(isIsoDate("2026-02-30")).toBe(false);
  });
  it("finds ranges covering a day, inclusive", () => {
    const r = [{ startDate: "2026-12-01", endDate: "2026-12-03", kind: "sick" }];
    expect(timeOffOn(r, "2026-12-01")).toHaveLength(1);
    expect(timeOffOn(r, "2026-12-03")).toHaveLength(1);
    expect(timeOffOn(r, "2026-12-04")).toHaveLength(0);
  });
  it("formats a single day and a range", () => {
    expect(formatRange({ startDate: "2026-12-01", endDate: "2026-12-01" })).toBe("2026-12-01");
    expect(formatRange({ startDate: "2026-12-01", endDate: "2026-12-03" })).toBe("2026-12-01 to 2026-12-03");
  });
});
