import { describe, expect, it } from "vitest";
import { detectLinkType, normalizeUrl } from "../src/lib/links";
import { addDays, dueLabel, isISODate, startOfWeek } from "../src/lib/dates";

describe("detectLinkType (same rules as the Todo App)", () => {
  it.each([
    ["https://acme.webex.com/meet/x", "webex"],
    ["https://github.com/o/r/pull/12", "pr"],
    ["https://gitlab.com/o/r/-/merge_requests/3", "pr"],
    ["https://x.test/notes.md", "markdown"],
    ["https://x.test/plan.docx", "doc"],
    ["https://docs.google.com/document/d/1", "doc"],
    ["https://example.com", "link"],
  ])("%s -> %s", (url, type) => {
    expect(detectLinkType(url)).toBe(type);
  });
});

describe("normalizeUrl", () => {
  it("adds https and rejects non-http schemes", () => {
    expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });
});

describe("dueLabel", () => {
  const today = "2026-10-17";
  it("matches the Todo App pill rules", () => {
    expect(dueLabel(null, today).text).toBe("+ Due date");
    expect(dueLabel("2026-10-17", today).text).toBe("Today");
    expect(dueLabel("2026-10-18", today).text).toBe("Tomorrow");
    expect(dueLabel("2026-10-14", today)).toEqual({ text: "Overdue 3d", className: "due-overdue" });
    expect(dueLabel("2026-10-29", today).text).toBe("Oct 29");
  });
});

describe("date helpers", () => {
  it("validates ISO dates", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-02-28")).toBe(true);
  });
  it("finds Monday and adds days across month ends", () => {
    expect(startOfWeek("2026-10-17")).toBe("2026-10-12"); // Saturday -> Monday
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

import { addMonths, endOfMonth, monthWeeks, startOfMonth } from "../src/lib/dates";
import { applyReorder } from "../src/lib/taskTypes";

describe("month helpers", () => {
  it("moves between months and finds month bounds", () => {
    expect(addMonths("2026-10-17", 1)).toBe("2026-11-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(startOfMonth("2026-10-17")).toBe("2026-10-01");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });
  it("lays a month out in Monday-first weeks of 7", () => {
    const weeks = monthWeeks("2026-10-17"); // Oct 1 2026 is a Thursday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toBe("2026-09-28");
    expect(weeks[0][3]).toBe("2026-10-01");
    expect(weeks[weeks.length - 1]).toContain("2026-10-31");
  });
});

describe("applyReorder", () => {
  const all = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  it("puts the moved ids into the same slots in the new order", () => {
    expect(applyReorder(all, ["d", "b"]).map((t) => t.id)).toEqual(["a", "d", "c", "b", "e"]);
  });
  it("leaves the list alone for an identical order", () => {
    expect(applyReorder(all, ["b", "d"])).toEqual(all);
  });
});

import { normalizeTheme, themeAttribute } from "../src/lib/theme";

describe("theme", () => {
  it("accepts only known themes and defaults to system", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("purple")).toBe("system");
    expect(normalizeTheme(undefined)).toBe("system");
  });
  it("leaves the attribute unset for system so the OS preference applies", () => {
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute("dark")).toBe("dark");
  });
});

import {
  PALETTE,
  UNASSIGNED_ID,
  UNASSIGNED_COLOR,
  buildAnalytics,
  buildTeamAnalytics,
  employeeColor,
  lastNDays,
  localDateKey,
  parseWindow,
  NO_CATEGORY,
} from "../src/lib/analytics";

const PT = "America/Los_Angeles";
// Instants are UTC so the tests do not depend on the machine's own time zone.
const at = (iso: string) => new Date(iso).getTime();

describe("task analytics", () => {
  const NOON = at("2026-10-17T19:00:00Z"); // noon PDT on the 17th
  const done = (iso: string, categoryId: string | null) => ({ completed: true, completedAt: at(iso), categoryId });

  it("builds the last N practice-time-zone days ending today (inclusive)", () => {
    expect(lastNDays(3, NOON, PT)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(localDateKey(NOON, PT)).toBe("2026-10-17");
    expect(lastNDays(1, NOON, PT)).toEqual(["2026-10-17"]);
  });

  it("buckets by Pacific day: 11 pm Pacific is still that day even though it is already tomorrow in UTC", () => {
    expect(localDateKey(at("2026-10-18T06:00:00Z"), PT)).toBe("2026-10-17"); // 11 pm PDT
    expect(localDateKey(at("2026-10-17T06:59:00Z"), PT)).toBe("2026-10-16"); // 11:59 pm PDT the 16th
    expect(localDateKey(at("2026-10-17T07:00:00Z"), PT)).toBe("2026-10-17"); // midnight PDT
    expect(localDateKey(at("2026-01-15T07:59:00Z"), PT)).toBe("2026-01-14"); // winter (PST)
    // "today" itself rolls over at Pacific midnight
    expect(lastNDays(2, at("2026-10-18T06:30:00Z"), PT)).toEqual(["2026-10-16", "2026-10-17"]);
  });

  it("counts completions per day and category, ignoring open, undated and out-of-window tasks", () => {
    const tasks = [
      done("2026-10-17T19:00:00Z", "a"),
      done("2026-10-18T06:00:00Z", "a"), // 11 pm Pacific on the 17th
      done("2026-10-16T19:00:00Z", null),
      { completed: true, completedAt: null, categoryId: "a" }, // finished before dates were tracked
      { completed: false, completedAt: null, categoryId: "a" },
      done("2026-08-01T19:00:00Z", "a"), // outside the window
    ];
    const r = buildAnalytics(tasks, ["a", "b"], 30, NOON, PT);
    expect(r.totalCompleted).toBe(3);
    expect(r.counts["2026-10-17"]["a"]).toBe(2);
    expect(r.counts["2026-10-16"][NO_CATEGORY]).toBe(1);
    expect(r.tracks).toEqual(["a", NO_CATEGORY]); // "b" has no completions
    expect(r.maxDayTotal).toBe(2);
    expect(r.avgPerDay).toBeCloseTo(0.1);
  });
});

describe("team analytics", () => {
  const NOW = at("2026-10-17T19:00:00Z");
  const people = [
    { id: "e2", name: "Muntaha", active: true },
    { id: "e1", name: "Razak", active: true },
    { id: "e3", name: "Khalid", active: true },
    { id: "e9", name: "Old Hire", active: false },
  ];
  const colorKeys = ["e1", "e2", "e3", "e9"];
  const c = (assigneeId: string | null, iso: string | null, categoryId: string | null = null) => ({
    assigneeId,
    categoryId,
    completedAt: iso ? at(iso) : null,
  });
  const base = { people, colorKeys, completions: [], openRows: [], includeUnassigned: true, periodDays: 7, now: NOW, timeZone: PT };

  it("counts per employee and day, totals and averages", () => {
    const r = buildTeamAnalytics({
      ...base,
      completions: [c("e1", "2026-10-17T19:00:00Z"), c("e1", "2026-10-16T19:00:00Z"), c("e2", "2026-10-16T19:00:00Z"), c(null, "2026-10-15T19:00:00Z")],
    });
    expect(r.totalCompleted).toBe(4);
    expect(r.avgPerDay).toBeCloseTo(4 / 7);
    expect(r.counts["2026-10-16"]).toEqual({ e1: 1, e2: 1 });
    expect(r.dayTotals).toEqual([0, 0, 0, 0, 1, 2, 1]);
    expect(r.maxDayTotal).toBe(2);
    const razak = r.people.find((p) => p.id === "e1")!;
    expect(razak.completed).toBe(2);
    expect(razak.avgPerDay).toBeCloseTo(2 / 7);
    expect(r.people.find((p) => p.id === UNASSIGNED_ID)!.completed).toBe(1);
  });

  it("window boundaries are inclusive of today and of the first day, exclusive beyond", () => {
    const r = buildTeamAnalytics({
      ...base,
      completions: [
        c("e1", "2026-10-18T06:59:00Z"), // 11:59 pm Pacific the 17th = today
        c("e1", "2026-10-11T07:00:00Z"), // midnight Pacific the 11th = first day of a 7-day window
        c("e1", "2026-10-11T06:59:00Z"), // 11:59 pm the 10th = outside
        c("e1", "2026-10-18T07:00:00Z"), // midnight the 18th = tomorrow, outside
      ],
    });
    expect(r.days[0]).toBe("2026-10-11");
    expect(r.days[6]).toBe("2026-10-17");
    expect(r.totalCompleted).toBe(2);
  });

  it("buckets an 11 pm Pacific completion on its Pacific day", () => {
    const r = buildTeamAnalytics({ ...base, completions: [c("e1", "2026-10-18T06:00:00Z")] });
    expect(r.counts["2026-10-17"]).toEqual({ e1: 1 });
  });

  it("excludes undated completions from velocity and reports how many there are", () => {
    const r = buildTeamAnalytics({ ...base, undated: 2, completions: [c("e1", null), c("e1", "2026-10-17T19:00:00Z")] });
    expect(r.totalCompleted).toBe(1);
    expect(r.undated).toBe(3);
  });

  it("open and past-due counts skip expired tasks; past due needs a due date before today", () => {
    const r = buildTeamAnalytics({
      ...base,
      openRows: [
        { assigneeId: "e1", dueDate: null, expiresAt: null, count: 2 },
        { assigneeId: "e1", dueDate: "2026-10-16", expiresAt: null, count: 3 }, // past due
        { assigneeId: "e1", dueDate: "2026-10-17", expiresAt: null, count: 1 }, // due today: not past due
        { assigneeId: "e1", dueDate: "2026-10-01", expiresAt: "2026-10-10", count: 4 }, // expired: not counted at all
        { assigneeId: "e1", dueDate: "2026-10-01", expiresAt: "2026-10-17", count: 1 }, // expires today: still open, past due
        { assigneeId: null, dueDate: null, expiresAt: null, count: 5 },
      ],
    });
    const razak = r.people.find((p) => p.id === "e1")!;
    expect(razak.open).toBe(7);
    expect(razak.pastDue).toBe(4);
    expect(r.people.find((p) => p.id === UNASSIGNED_ID)!.open).toBe(5);
    expect(r.totalOpen).toBe(12);
    expect(r.totalPastDue).toBe(4);
  });

  it("recurring-generated tasks count like any other (they are ordinary rows)", () => {
    const r = buildTeamAnalytics({ ...base, completions: [c("e2", "2026-10-17T19:00:00Z")], openRows: [{ assigneeId: "e2", dueDate: "2026-10-16", expiresAt: "2026-10-30", count: 1 }] });
    const m = r.people.find((p) => p.id === "e2")!;
    expect([m.completed, m.open, m.pastDue]).toEqual([1, 1, 1]);
  });

  it("shows active employees with zeros, hides inactive ones unless they completed something in the window", () => {
    const quiet = buildTeamAnalytics({ ...base });
    expect(quiet.people.map((p) => p.name)).toEqual(["Khalid", "Muntaha", "Razak"]); // A to Z, no Old Hire, no Unassigned
    expect(quiet.people.every((p) => p.completed === 0 && p.open === 0 && p.pastDue === 0)).toBe(true);
    const r = buildTeamAnalytics({ ...base, completions: [c("e9", "2026-10-14T19:00:00Z")] });
    expect(r.people.map((p) => p.name)).toEqual(["Khalid", "Muntaha", "Old Hire", "Razak"]);
    expect(r.people.find((p) => p.id === "e9")!.completed).toBe(1);
    // completed only outside the window: hidden again
    expect(buildTeamAnalytics({ ...base, completions: [c("e9", "2026-09-01T19:00:00Z")] }).people.some((p) => p.id === "e9")).toBe(false);
  });

  it("empty state: nothing completed gives zero totals and no NaN", () => {
    const r = buildTeamAnalytics({ ...base });
    expect(r.totalCompleted).toBe(0);
    expect(r.avgPerDay).toBe(0);
    expect(r.maxDayTotal).toBe(1);
    expect(r.dayTotals.every((n) => n === 0)).toBe(true);
  });

  it("Unassigned appears only for the Admin, and only when it has something", () => {
    const rows = [c(null, "2026-10-17T19:00:00Z")];
    expect(buildTeamAnalytics({ ...base, completions: rows }).people.some((p) => p.id === UNASSIGNED_ID)).toBe(true);
    const nonAdmin = buildTeamAnalytics({ ...base, includeUnassigned: false, completions: rows, openRows: [{ assigneeId: null, dueDate: null, expiresAt: null, count: 3 }] });
    expect(nonAdmin.people.some((p) => p.id === UNASSIGNED_ID)).toBe(false);
    expect(nonAdmin.totalCompleted).toBe(0);
    expect(nonAdmin.totalOpen).toBe(0);
  });

  it("never counts an employee outside the allowed list, even if rows for them slip in", () => {
    const own = [{ id: "e1", name: "Razak", active: true }];
    const r = buildTeamAnalytics({
      ...base,
      people: own,
      includeUnassigned: false,
      completions: [c("e1", "2026-10-17T19:00:00Z"), c("e2", "2026-10-17T19:00:00Z"), c("e2", "2026-10-16T19:00:00Z")],
      openRows: [{ assigneeId: "e2", dueDate: "2026-10-01", expiresAt: null, count: 9 }],
    });
    expect(r.people.map((p) => p.id)).toEqual(["e1"]);
    expect(r.totalCompleted).toBe(1);
    expect(r.totalOpen).toBe(0);
    expect(r.totalPastDue).toBe(0);
    expect(JSON.stringify(r)).not.toContain("Muntaha");
  });

  it("colours are stable per employee whatever subset is visible, and wrap past the palette", () => {
    const all = ["e1", "e2", "e3", "e9"];
    expect(employeeColor("e2", all)).toBe(PALETTE[1]);
    expect(employeeColor("e2", [...all].reverse())).toBe(PALETTE[1]); // input order does not matter
    const subset = buildTeamAnalytics({ ...base, people: [people[0]], includeUnassigned: false });
    expect(subset.people[0].color).toBe(PALETTE[1]); // Muntaha keeps her colour when she is the only one visible
    const many = Array.from({ length: PALETTE.length + 2 }, (_, i) => `x${String(i).padStart(2, "0")}`);
    expect(employeeColor(many[PALETTE.length], many)).toBe(PALETTE[0]);
    expect(employeeColor(UNASSIGNED_ID, many)).toBe(UNASSIGNED_COLOR);
  });

  it("parseWindow accepts 7, 30 and 90 and falls back to 30", () => {
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow("90")).toBe(90);
    for (const bad of [undefined, "", "14", "abc", "-7", "30; drop"]) expect(parseWindow(bad)).toBe(30);
  });
});

import { splitTasks } from "../src/lib/taskTypes";

describe("splitTasks (Past due / Today / Backlog / Completed)", () => {
  const today = "2026-10-17";
  const t = (
    id: string,
    over: Partial<{ completed: boolean; dueDate: string | null; expiresAt: string | null; inToday: boolean; sortOrder: number }> = {},
  ) => ({
    id,
    completed: false,
    dueDate: null as string | null,
    expiresAt: null as string | null,
    inToday: false,
    sortOrder: 0,
    ...over,
  });
  const ids = (list: { id: string }[]) => list.map((x) => x.id);

  it("puts overdue open tasks in Past due, most overdue first, and nowhere else", () => {
    const r = splitTasks([t("a", { dueDate: "2026-10-16" }), t("b", { dueDate: "2026-10-01", inToday: true })], today);
    expect(ids(r.pastDue)).toEqual(["b", "a"]);
    expect(r.today).toEqual([]);
    expect(r.backlog).toEqual([]);
  });
  it("shows tasks due today, or flagged for Today, in Today", () => {
    const r = splitTasks([t("due", { dueDate: today }), t("flag", { inToday: true }), t("later", { dueDate: "2026-10-30" })], today);
    expect(ids(r.today)).toEqual(["due", "flag"]);
    expect(ids(r.backlog)).toEqual(["later"]);
  });
  it("moves open tasks past their expiration date to Expired, out of every other section", () => {
    const r = splitTasks(
      [
        t("old", { dueDate: "2026-10-01", expiresAt: "2026-10-10" }),
        t("still", { dueDate: "2026-10-01", expiresAt: "2026-10-17" }), // expires today: still active
        t("none", { dueDate: "2026-10-01" }), // no expiration
        t("done", { completed: true, expiresAt: "2026-10-01" }), // finished tasks never expire
      ],
      today,
    );
    expect(ids(r.expired)).toEqual(["old"]);
    expect(ids(r.pastDue)).toEqual(["still", "none"]);
    expect(ids(r.completed)).toEqual(["done"]);
  });
  it("keeps undated, unflagged tasks in Backlog and done tasks in Completed", () => {
    const r = splitTasks([t("x"), t("done", { completed: true, dueDate: "2026-01-01" })], today);
    expect(ids(r.backlog)).toEqual(["x"]);
    expect(ids(r.completed)).toEqual(["done"]);
    expect(r.pastDue).toEqual([]);
  });
});

import { applyOrder } from "../src/lib/order";

describe("applyOrder (remembered tab order)", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  it("follows the saved order", () => {
    expect(applyOrder(items, ["c", "a"]).map((i) => i.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("ignores ids that no longer exist and keeps new items at the end", () => {
    expect(applyOrder(items, ["zzz", "d", "b"]).map((i) => i.id)).toEqual(["d", "b", "a", "c"]);
    expect(applyOrder(items, []).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});

import { describeRule, latestOccurrence, nextOccurrenceAfter, ruleError } from "../src/lib/recurrence";

describe("recurrence rules", () => {
  const base = { weekday: null, dayOfMonth: null, startDate: "2026-01-01", endDate: null as string | null };
  // 2026-10-17 is a Saturday.
  it("daily means weekdays only: weekends roll back to Friday and the next one skips to Monday", () => {
    const daily = { ...base, frequency: "DAILY" };
    expect(latestOccurrence(daily, "2026-10-16")).toBe("2026-10-16"); // Friday
    expect(latestOccurrence(daily, "2026-10-17")).toBe("2026-10-16"); // Saturday -> Friday
    expect(latestOccurrence(daily, "2026-10-18")).toBe("2026-10-16"); // Sunday -> Friday
    expect(latestOccurrence(daily, "2026-10-19")).toBe("2026-10-19"); // Monday
    expect(nextOccurrenceAfter(daily, "2026-10-15")).toBe("2026-10-16"); // Thu -> Fri
    expect(nextOccurrenceAfter(daily, "2026-10-16")).toBe("2026-10-19"); // Fri -> Mon
    expect(nextOccurrenceAfter(daily, "2026-10-17")).toBe("2026-10-19"); // Sat -> Mon
  });
  it("weekly: the most recent matching weekday, and the next one", () => {
    const monday = { ...base, frequency: "WEEKLY", weekday: 0 };
    expect(latestOccurrence(monday, "2026-10-17")).toBe("2026-10-12");
    expect(latestOccurrence(monday, "2026-10-12")).toBe("2026-10-12");
    expect(nextOccurrenceAfter(monday, "2026-10-17")).toBe("2026-10-19");
    expect(nextOccurrenceAfter(monday, "2026-10-12")).toBe("2026-10-19");
    expect(latestOccurrence({ ...base, frequency: "WEEKLY", weekday: 5 }, "2026-10-17")).toBe("2026-10-17"); // Saturday
  });
  it("monthly: the most recent day-of-month, clamping short months", () => {
    const m15 = { ...base, frequency: "MONTHLY", dayOfMonth: 15 };
    expect(latestOccurrence(m15, "2026-10-17")).toBe("2026-10-15");
    expect(latestOccurrence(m15, "2026-10-10")).toBe("2026-09-15");
    expect(nextOccurrenceAfter(m15, "2026-10-17")).toBe("2026-11-15");
    const m31 = { ...base, frequency: "MONTHLY", dayOfMonth: 31 };
    expect(latestOccurrence(m31, "2026-03-05")).toBe("2026-02-28");
    expect(nextOccurrenceAfter(m31, "2026-01-31")).toBe("2026-02-28");
  });
  it("respects the start and end dates", () => {
    const rule = { ...base, frequency: "DAILY", startDate: "2026-10-20", endDate: "2026-10-25" };
    expect(latestOccurrence(rule, "2026-10-17")).toBeNull();
    expect(latestOccurrence(rule, "2026-10-22")).toBe("2026-10-22");
    expect(latestOccurrence(rule, "2026-12-01")).toBe("2026-10-23"); // ends Sunday the 25th -> last weekday is Friday the 23rd
    expect(latestOccurrence({ ...rule, startDate: "2026-10-17", endDate: null }, "2026-10-18")).toBeNull(); // only a weekend in range so far
    expect(nextOccurrenceAfter(rule, "2026-10-23")).toBeNull();
    expect(nextOccurrenceAfter(rule, "2026-10-10")).toBe("2026-10-20");
  });
  it("validates and describes rules", () => {
    expect(ruleError({ ...base, frequency: "WEEKLY" })).toMatch(/day of the week/);
    expect(ruleError({ ...base, frequency: "MONTHLY", dayOfMonth: 32 })).toMatch(/day of the month/);
    expect(ruleError({ ...base, frequency: "YEARLY" })).toMatch(/daily, weekly or monthly/);
    expect(ruleError({ ...base, frequency: "DAILY", endDate: "2025-12-31" })).toMatch(/end date/);
    expect(ruleError({ ...base, frequency: "DAILY" })).toBeNull();
    expect(describeRule({ frequency: "WEEKLY", weekday: 2, dayOfMonth: null })).toBe("Every Wednesday");
    expect(describeRule({ frequency: "DAILY", weekday: null, dayOfMonth: null })).toMatch(/weekday/);
    expect(describeRule({ frequency: "MONTHLY", weekday: null, dayOfMonth: 1 })).toBe("Monthly on the 1st");
    expect(describeRule({ frequency: "MONTHLY", weekday: null, dayOfMonth: 22 })).toBe("Monthly on the 22nd");
  });
});

import { isOccurrence, planReconcile } from "../src/lib/recurrence";

describe("isOccurrence", () => {
  const base = { weekday: null, dayOfMonth: null, startDate: "2026-10-05", endDate: null as string | null };
  it("daily is weekdays inside the start and end dates", () => {
    const d = { ...base, frequency: "DAILY", endDate: "2026-10-30" };
    expect(isOccurrence(d, "2026-10-19")).toBe(true); // Monday
    expect(isOccurrence(d, "2026-10-17")).toBe(false); // Saturday
    expect(isOccurrence(d, "2026-10-02")).toBe(false); // before start
    expect(isOccurrence(d, "2026-11-02")).toBe(false); // after end
  });
  it("weekly and monthly match their day", () => {
    expect(isOccurrence({ ...base, frequency: "WEEKLY", weekday: 0 }, "2026-10-19")).toBe(true);
    expect(isOccurrence({ ...base, frequency: "WEEKLY", weekday: 0 }, "2026-10-20")).toBe(false);
    expect(isOccurrence({ ...base, frequency: "MONTHLY", dayOfMonth: 15 }, "2026-10-15")).toBe(true);
    expect(isOccurrence({ ...base, frequency: "MONTHLY", dayOfMonth: 31 }, "2026-11-30")).toBe(true); // short month clamps
    expect(isOccurrence({ ...base, frequency: "MONTHLY", dayOfMonth: 31 }, "2026-11-29")).toBe(false);
  });
});

describe("planReconcile (editing a recurring task keeps the queue in line)", () => {
  const today = "2026-10-19"; // Monday
  const rule = (o: object = {}) => ({ frequency: "WEEKLY", weekday: 0, dayOfMonth: null, startDate: "2026-10-12", endDate: null as string | null, active: true, ...o });
  const inst = (id: string, occurrenceDate: string, completed = false) => ({ id, occurrenceDate, completed });

  it("removes today's open task when the start date moves later (the reported bug)", () => {
    const plan = planReconcile(rule({ startDate: "2026-10-26" }), [inst("a", "2026-10-19")], today);
    expect(plan.deleteIds).toEqual(["a"]);
    expect(plan.lastOccurrence).toBeNull(); // nothing to skip: the first one is generated on 10/26
  });
  it("keeps finished tasks as history", () => {
    const plan = planReconcile(rule({ startDate: "2026-10-26" }), [inst("done", "2026-10-19", true)], today);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.lastOccurrence).toBe("2026-10-19"); // so today's finished task is not re-created
  });
  it("removes open tasks after a new, earlier end date", () => {
    const plan = planReconcile(rule({ frequency: "DAILY", endDate: "2026-10-14" }), [inst("a", "2026-10-13"), inst("b", "2026-10-16")], today);
    expect(plan.deleteIds).toEqual(["b"]);
  });
  it("removes open tasks on the old weekday or day of month when that changes", () => {
    expect(planReconcile(rule({ weekday: 2 }), [inst("mon", "2026-10-19")], today).deleteIds).toEqual(["mon"]);
    expect(planReconcile(rule({ frequency: "MONTHLY", weekday: null, dayOfMonth: 20 }), [inst("fifteenth", "2026-10-15")], today).deleteIds).toEqual(["fifteenth"]);
  });
  it("keeps an open task that is still a valid occurrence of the new rule", () => {
    const plan = planReconcile(rule({ frequency: "DAILY" }), [inst("a", "2026-10-14")], today); // Wed, valid weekday
    expect(plan.deleteIds).toEqual([]);
  });
  it("does not back-fill earlier occurrences just because the rule changed", () => {
    const plan = planReconcile(rule({ weekday: 2 }), [], today); // Wednesdays; the last one, 10/14, is already past
    expect(plan.lastOccurrence).toBe("2026-10-14");
  });
  it("leaves today's occurrence to be generated when the rule now includes today", () => {
    const plan = planReconcile(rule({ weekday: 0, startDate: "2026-10-01" }), [], today);
    expect(plan.lastOccurrence).toBe("2026-10-12"); // today (10/19) is after it, so it will be generated
  });
  it("paused: removes tasks that are not due yet but keeps current and overdue ones", () => {
    const plan = planReconcile(rule({ active: false }), [inst("future", "2026-10-26"), inst("today", "2026-10-19"), inst("past", "2026-10-12")], today);
    expect(plan.deleteIds).toEqual(["future"]);
  });
});

import { canEditBoard, pickEmployee, viewableEmployeeIds } from "../src/lib/taskAccess";
import { todayISO } from "../src/lib/dates";

describe("practice time zone for today", () => {
  // 03:00 UTC on Oct 18 is still the evening of Oct 17 in Los Angeles.
  const instant = new Date("2026-10-18T03:00:00Z");
  it("uses the practice zone, not the server's, so everybody gets the same 'today'", () => {
    expect(todayISO(instant, "America/Los_Angeles")).toBe("2026-10-17");
    expect(todayISO(instant, "UTC")).toBe("2026-10-18");
    expect(todayISO(new Date("2026-10-18T08:00:00Z"), "America/Los_Angeles")).toBe("2026-10-18");
  });
  it("handles the daylight-saving change", () => {
    expect(todayISO(new Date("2026-11-01T08:30:00Z"), "America/Los_Angeles")).toBe("2026-11-01");
    expect(todayISO(new Date("2026-11-01T07:30:00Z"), "America/Los_Angeles")).toBe("2026-11-01");
  });
});

describe("task visibility", () => {
  const allIds = ["sohail", "razak", "muntaha", "khalid", "lucy"];
  it("the Admin sees everyone", () => {
    expect(viewableEmployeeIds({ isAdmin: true, meId: "sohail", grantedIds: [], allIds })).toEqual(allIds);
  });
  it("others see their own list first, plus any granted lists", () => {
    expect(viewableEmployeeIds({ isAdmin: false, meId: "razak", grantedIds: ["muntaha"], allIds })).toEqual(["razak", "muntaha"]);
    expect(viewableEmployeeIds({ isAdmin: false, meId: "khalid", grantedIds: [], allIds })).toEqual(["khalid"]);
  });
  it("ignores grants to unknown or inactive employees and duplicates of themselves", () => {
    expect(viewableEmployeeIds({ isAdmin: false, meId: "razak", grantedIds: ["razak", "ghost", "muntaha", "muntaha"], allIds })).toEqual(["razak", "muntaha"]);
  });
  it("a login with no employee record sees nothing but their grants", () => {
    expect(viewableEmployeeIds({ isAdmin: false, meId: null, grantedIds: ["muntaha"], allIds })).toEqual(["muntaha"]);
    expect(viewableEmployeeIds({ isAdmin: false, meId: null, grantedIds: [], allIds })).toEqual([]);
  });
  it("a requested list outside the allowed set falls back to the user's own", () => {
    const allowed = ["razak", "muntaha"];
    expect(pickEmployee("muntaha", allowed, "razak")).toBe("muntaha");
    expect(pickEmployee("khalid", allowed, "razak")).toBe("razak"); // not allowed: URL tampering
    expect(pickEmployee(undefined, allowed, "razak")).toBe("razak");
    expect(pickEmployee("khalid", [], null)).toBeNull();
  });
  it("other people's lists are read-only; your own is editable with edit access", () => {
    expect(canEditBoard({ isAdmin: false, moduleEdit: true, meId: "razak", selected: "razak" })).toBe(true);
    expect(canEditBoard({ isAdmin: false, moduleEdit: true, meId: "razak", selected: "muntaha" })).toBe(false);
    expect(canEditBoard({ isAdmin: false, moduleEdit: false, meId: "razak", selected: "razak" })).toBe(false);
    expect(canEditBoard({ isAdmin: true, moduleEdit: true, meId: "sohail", selected: "muntaha" })).toBe(true);
    expect(canEditBoard({ isAdmin: true, moduleEdit: true, meId: "sohail", selected: null })).toBe(true); // Unassigned
    expect(canEditBoard({ isAdmin: false, moduleEdit: true, meId: "razak", selected: null })).toBe(false);
  });
});

import { decodeFirestoreValue, parseTodoState, planTodoSync, type ExistingTask, type SourceTodo } from "../src/lib/todoSync";

describe("Todo App sync: reading Firestore", () => {
  it("decodes Firestore REST values to plain JSON", () => {
    const doc = {
      mapValue: {
        fields: {
          title: { stringValue: "A" },
          n: { integerValue: "1791216126700" },
          ok: { booleanValue: true },
          none: { nullValue: null },
          list: { arrayValue: { values: [{ stringValue: "x" }] } },
          empty: { arrayValue: {} },
        },
      },
    };
    expect(decodeFirestoreValue(doc)).toEqual({ title: "A", n: 1791216126700, ok: true, none: null, list: ["x"], empty: [] });
  });
  it("keeps only valid todos and cleans links, and rejects unexpected data", () => {
    const state = parseTodoState({
      categories: [{ id: "c", name: "B & BC" }, { nope: 1 }],
      todos: [
        { id: "1", title: " Task ", categoryId: "c", completed: false, dueDate: "2026-10-05", inToday: true, links: [{ url: "javascript:alert(1)" }, { url: "example.com/a" }] },
        { title: "no id" },
      ],
    });
    expect(state.categories).toEqual([{ id: "c", name: "B & BC" }]);
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0]).toMatchObject({ title: "Task", dueDate: "2026-10-05", inToday: true, links: ["https://example.com/a"] });
    expect(() => parseTodoState({ categories: "x" })).toThrow();
  });
});

describe("Todo App sync: planning", () => {
  const src = (id: string, over: Partial<SourceTodo> = {}): SourceTodo => ({
    id, title: `Todo ${id}`, notes: "", categoryId: "c", dueDate: null, completed: false, completedAt: null, inToday: false, links: [], ...over,
  });
  const task = (id: string, over: Partial<ExistingTask> = {}): ExistingTask => ({
    id, title: `Todo ${id}`, notes: "", dueDate: null, completed: false, completedAt: null, inToday: false, externalId: id, linkUrls: [], ...over,
  });

  it("creates tasks for new todos", () => {
    const p = planTodoSync([src("a", { notes: "hi", dueDate: "2026-10-20" })], []);
    expect(p.create).toHaveLength(1);
    expect(p.create[0]).toMatchObject({ externalId: "a", values: { title: "Todo a", notes: "hi", dueDate: "2026-10-20" } });
  });
  it("is idempotent: syncing unchanged data does nothing", () => {
    const p = planTodoSync([src("a"), src("b")], [task("a"), task("b")]);
    expect(p).toMatchObject({ create: [], update: [], remove: [], unchanged: 2 });
  });
  it("copies changes from the Todo App: title, notes, due date, Today, links, completion", () => {
    const p = planTodoSync(
      [src("a", { title: "New", notes: "n", dueDate: "2026-11-01", inToday: true, completed: true, completedAt: 5, links: ["https://x.test/"] })],
      [task("a")],
    );
    expect(p.update).toHaveLength(1);
    expect(p.update[0].values).toEqual({ title: "New", notes: "n", dueDate: "2026-11-01", inToday: true, completed: true, completedAt: 5 });
    expect(p.update[0].links).toEqual(["https://x.test/"]);
  });
  it("reopening a todo clears the completion time", () => {
    const p = planTodoSync([src("a")], [task("a", { completed: true, completedAt: 9 })]);
    expect(p.update[0].values).toEqual({ completed: false, completedAt: null });
  });
  it("adopts a task made before syncing existed, by exact title, instead of duplicating it", () => {
    const p = planTodoSync([src("a", { title: "September invoice" })], [task("t1", { title: "september invoice", externalId: null })]);
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([{ id: "t1", externalId: "a", values: { title: "September invoice" } }]); // takes the Todo App's spelling
  });
  it("adopts each existing task at most once when titles repeat", () => {
    const p = planTodoSync([src("a", { title: "Same" }), src("b", { title: "Same" })], [task("t1", { title: "Same", externalId: null })]);
    expect(p.update).toHaveLength(1);
    expect(p.create).toHaveLength(1);
  });
  it("removes open tasks whose todo is gone, but keeps finished ones and tasks that were never mirrored", () => {
    const p = planTodoSync([src("a")], [task("a"), task("gone"), task("done", { completed: true }), task("local", { externalId: null, title: "Mine" })]);
    expect(p.remove).toEqual(["gone"]);
  });
});
