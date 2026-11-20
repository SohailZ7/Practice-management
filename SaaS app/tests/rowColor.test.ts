import { describe, expect, it } from "vitest";
import { isOverdue, rowTone } from "../src/lib/notes/rowColor";

describe("rowTone", () => {
  it("follows the workbook colours", () => {
    expect(rowTone({ status: "scheduled", docCount: 0, hasDraft: false })).toBe("white");
    expect(rowTone({ status: "no_show", docCount: 0, hasDraft: false })).toBe("gray");
    expect(rowTone({ status: "cancelled", docCount: 1, hasDraft: false })).toBe("gray");
    expect(rowTone({ status: "seen", docCount: 0, hasDraft: false })).toBe("yellow");
    expect(rowTone({ status: "seen", docCount: 2, hasDraft: true })).toBe("blue");
    expect(rowTone({ status: "note_signed", docCount: 2, hasDraft: false })).toBe("green");
  });
});

describe("isOverdue", () => {
  it("flags unfinished visits more than 7 days old only", () => {
    expect(isOverdue("2026-11-01", "scheduled", "2026-11-09")).toBe(true);
    expect(isOverdue("2026-11-01", "scheduled", "2026-11-08")).toBe(false);
    expect(isOverdue("2026-11-01", "seen", "2026-12-01")).toBe(false);
    expect(isOverdue("2026-11-01", "cancelled", "2026-12-01")).toBe(false);
    expect(isOverdue("bad", "scheduled", "2026-12-01")).toBe(false);
  });
});
