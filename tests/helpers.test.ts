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

import { buildAnalytics, lastNDays, localDateKey, NO_CATEGORY } from "../src/lib/analytics";

describe("task analytics", () => {
  const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
  const NOW = noon(2026, 10, 17);

  it("builds the last N local days ending today", () => {
    const days = lastNDays(3, NOW);
    expect(days).toEqual(["2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(localDateKey(NOW)).toBe("2026-10-17");
  });

  it("counts completions per day and category, ignoring open, undated and out-of-window tasks", () => {
    const tasks = [
      { completed: true, completedAt: noon(2026, 10, 17), categoryId: "a" },
      { completed: true, completedAt: noon(2026, 10, 17), categoryId: "a" },
      { completed: true, completedAt: noon(2026, 10, 16), categoryId: null },
      { completed: true, completedAt: null, categoryId: "a" }, // finished before dates were tracked
      { completed: false, completedAt: null, categoryId: "a" },
      { completed: true, completedAt: noon(2026, 8, 1), categoryId: "a" }, // outside the window
    ];
    const r = buildAnalytics(tasks, ["a", "b"], 30, NOW);
    expect(r.totalCompleted).toBe(3);
    expect(r.counts["2026-10-17"]["a"]).toBe(2);
    expect(r.counts["2026-10-16"][NO_CATEGORY]).toBe(1);
    expect(r.tracks).toEqual(["a", NO_CATEGORY]); // "b" has no completions
    expect(r.maxDayTotal).toBe(2);
    expect(r.avgPerDay).toBeCloseTo(0.1);
  });
});

import { splitTasks } from "../src/lib/taskTypes";

describe("splitTasks (Past due / Today / Backlog / Completed)", () => {
  const today = "2026-10-17";
  const t = (id: string, over: Partial<{ completed: boolean; dueDate: string | null; inToday: boolean; sortOrder: number }> = {}) => ({
    id,
    completed: false,
    dueDate: null as string | null,
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
