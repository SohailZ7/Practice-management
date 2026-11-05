import { describe, expect, it } from "vitest";
import {
  chargeCents, entryError, formatMoney, formatTime, minutesWorked, monthKey, monthTabs, parseRate, parseTime, sheetDate,
  sortEntries, timesheetAccess, toCsv, totals,
} from "../src/lib/timesheets/calc";

describe("time parsing", () => {
  it("reads 12-hour and 24-hour times", () => {
    expect(parseTime("5:27 PM")).toBe(17 * 60 + 27);
    expect(parseTime("6:06pm")).toBe(18 * 60 + 6);
    expect(parseTime("17:27")).toBe(17 * 60 + 27);
    expect(parseTime("12:05 AM")).toBe(5);
    expect(parseTime("12:00 PM")).toBe(720);
    expect(parseTime("8 PM")).toBe(1200);
  });
  it("rejects nonsense", () => {
    for (const bad of ["", "25:00", "13:00 PM", "5:60", "abc", "0:30 PM"]) expect(parseTime(bad)).toBeNull();
  });
  it("formats like the sheet", () => {
    expect(formatTime(17 * 60 + 27)).toBe("5:27 PM");
    expect(formatTime(0)).toBe("12:00 AM");
    expect(formatTime(12 * 60 + 5)).toBe("12:05 PM");
  });
});

describe("minutes and charge (reference sheet)", () => {
  it("10/01/26 5:27 PM to 6:06 PM is 39 minutes at $23.00 = $14.95", () => {
    const m = minutesWorked(parseTime("5:27 PM")!, parseTime("6:06 PM")!);
    expect(m).toBe(39);
    expect(chargeCents(m, 2300)).toBe(1495);
    expect(formatMoney(1495)).toBe("$14.95");
  });
  it("rounds to the nearest cent", () => {
    expect(chargeCents(1, 2300)).toBe(38); // 0.3833
    expect(chargeCents(7, 3000)).toBe(350);
    expect(chargeCents(0, 3000)).toBe(0);
  });
  it("parses rates", () => {
    expect(parseRate("23")).toBe(2300);
    expect(parseRate("$30.00")).toBe(3000);
    expect(parseRate("23.5")).toBe(2350);
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });
});

describe("entry validation", () => {
  const ok = { date: "2026-10-01", startMin: 1047, endMin: 1086, rateCents: 2300 };
  it("accepts a normal entry", () => expect(entryError(ok)).toBeNull());
  it("requires end after start", () => {
    expect(entryError({ ...ok, endMin: ok.startMin })).toMatch(/after start/);
    expect(entryError({ ...ok, endMin: 10 })).toMatch(/after start/);
  });
  it("rejects bad date and rate", () => {
    expect(entryError({ ...ok, date: "10/01/26" })).toMatch(/date/);
    expect(entryError({ ...ok, rateCents: -1 })).toMatch(/rate/);
    expect(entryError({ ...ok, rateCents: 10_000_000 })).toMatch(/rate/);
  });
});

describe("months, totals, csv", () => {
  const rows = [
    { id: "b", date: "2026-10-01", startMin: 20 * 60 + 17, endMin: 21 * 60, rateCents: 3000 },
    { id: "a", date: "2026-10-01", startMin: 17 * 60 + 27, endMin: 18 * 60 + 6, rateCents: 2300 },
    { id: "c", date: "2026-09-30", startMin: 600, endMin: 660, rateCents: 2300 },
  ];
  it("several entries on one date sort by start time", () => {
    expect(sortEntries(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
  it("monthly totals add minutes and per-entry charges", () => {
    const oct = rows.filter((r) => monthKey(r.date) === "2026-10");
    expect(totals(oct)).toEqual({ entries: 2, minutes: 39 + 43, chargeCents: 1495 + 2150 });
  });
  it("month tabs are newest first and always include the current month", () => {
    expect(monthTabs(rows.map((r) => r.date), "2026-11")).toEqual(["2026-11", "2026-10", "2026-09"]);
  });
  it("csv matches the sheet columns and ends with a total", () => {
    const csv = toCsv(rows.filter((r) => r.id !== "c")).trim().split("\r\n");
    expect(csv[0]).toBe("Date,Start Time,End Time,Minutes Worked,Rate / Hr,Charge");
    expect(csv[1]).toBe("10/01/26,5:27 PM,6:06 PM,39,$23.00,$14.95");
    expect(csv[2]).toBe("10/01/26,8:17 PM,9:00 PM,43,$30.00,$21.50");
    expect(csv[3]).toBe("Total,,,82,,$36.45");
  });
  it("sheet dates", () => expect(sheetDate("2026-10-01")).toBe("10/01/26"));
});

describe("access", () => {
  const admin = { id: "u1", role: "ADMIN", active: true };
  const staff = { id: "u2", role: "STAFF", active: true };
  it("is admin only today", () => {
    expect(timesheetAccess(admin)).toBe("all");
    expect(timesheetAccess(staff, { userId: "u2" })).toBe("none"); // own-sheet access is built but switched off
    expect(timesheetAccess({ ...admin, active: false })).toBe("none");
  });
});
