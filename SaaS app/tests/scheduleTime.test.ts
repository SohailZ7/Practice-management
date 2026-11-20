import { describe, expect, it } from "vitest";
import { formatTimeText, minutesOf, parseSpan, sortRows, TIME_PRESETS } from "../src/lib/notes/scheduleTime";

describe("times", () => {
  it("reads single times and ranges", () => {
    expect(minutesOf("2:00 PM")).toBe(14 * 60);
    expect(minutesOf("12:30 AM")).toBe(30);
    expect(minutesOf("14:05")).toBe(14 * 60 + 5);
    expect(minutesOf("2:00")).toBe(14 * 60);
    expect(minutesOf("9:00")).toBe(9 * 60);
    expect(minutesOf("soon")).toBeNull();
    expect(minutesOf("13:99")).toBeNull();
    expect(parseSpan("9:00 AM-12:00 PM")).toEqual({ start: 540, end: 720, exact: false });
    expect(parseSpan("10:00 AM")).toEqual({ start: 600, end: 600, exact: true });
    expect(parseSpan("")).toBeNull();
    expect(parseSpan("a-b-c")).toBeNull();
  });
  it("sorts exact times ahead of ranges that run later (the requested example)", () => {
    const rows = [
      { n: "p1", apptTime: "9:00 AM-12:00 PM" }, { n: "p2", apptTime: "12:00 PM-3:00 PM" }, { n: "p3", apptTime: "9:00 AM-11:00 AM" },
      { n: "p4", apptTime: "10:00 AM" }, { n: "p5", apptTime: "1:00 PM" }, { n: "none", apptTime: "" },
    ];
    expect(sortRows(rows).map((r) => r.n)).toEqual(["p4", "p3", "p1", "p5", "p2", "none"]);
  });
  it("on a tie the exact time comes first, and the input is not mutated", () => {
    const rows = [{ n: "r", apptTime: "9:00 AM-10:00 AM" }, { n: "e", apptTime: "10:00 AM" }];
    expect(sortRows(rows).map((r) => r.n)).toEqual(["e", "r"]);
    expect(rows[0].n).toBe("r");
  });
  it("formats 12-hour and military", () => {
    expect(formatTimeText("2:00 PM", true)).toBe("1400");
    expect(formatTimeText("9:00 AM-12:00 PM", true)).toBe("0900-1200");
    expect(formatTimeText("1400-1500", false)).toBe("1400-1500"); // not a time with a colon: unchanged
    expect(formatTimeText("14:00", false)).toBe("2:00 PM");
    expect(formatTimeText("12:00 AM", true)).toBe("0000");
    expect(formatTimeText("TBD", true)).toBe("TBD");
  });
  it("every preset is a valid range", () => {
    for (const p of TIME_PRESETS) expect(parseSpan(p)?.exact).toBe(false);
  });
});

import { isTypedTimeOk as _ok, TIME_PRESETS as _presets } from "@/lib/notes/scheduleTime";
import { describe as _d, it as _it, expect as _e } from "vitest";
_d("isTypedTimeOk (Block Times pick list)", () => {
  _it("accepts every pre-made range and normal typing", () => {
    for (const t of _presets) _e(_ok(t)).toBe(true);
    for (const t of ["", "2:00 PM", "14:00", "2 PM", "0900", "0900-1200", "9:00 AM-12:00 PM"]) _e(_ok(t)).toBe(true);
  });
  _it("rejects nonsense", () => {
    for (const t of ["lunch", "9-", "1:2:3", "9:00 AM-10:00 AM-11:00 AM"] ) _e(_ok(t)).toBe(false);
  });
});
