import { describe, expect, it } from "vitest";
import { boardColumns, progressLine, taskProgress } from "@/lib/taskInsights";
import type { TaskDTO } from "@/lib/taskTypes";

const base: TaskDTO = { id: "", title: "t", notes: "", categoryId: null, assigneeId: null, dueDate: null, expiresAt: null, completed: false, completedAt: null, inToday: false, sortOrder: 0, recurring: false, links: [] };
const T = (o: Partial<TaskDTO>): TaskDTO => ({ ...base, ...o });
const noon = Date.UTC(2026, 10, 18, 20); // 2026-11-18 noon in Los Angeles

describe("task progress", () => {
  it("counts finished today, open, due this week and overdue", () => {
    const p = taskProgress([
      T({ id: "1", completed: true, completedAt: noon }),
      T({ id: "2", completed: true, completedAt: noon - 3 * 86400000 }),
      T({ id: "3", dueDate: "2026-11-20" }),
      T({ id: "4", dueDate: "2026-11-10" }),
      T({ id: "5", dueDate: "2026-12-30" }),
      T({ id: "6", expiresAt: "2026-11-01" }),
    ], "2026-11-18", "America/Los_Angeles");
    expect(p).toMatchObject({ doneToday: 1, open: 3, total: 4, dueThisWeek: 1, overdue: 1, pct: 25 });
    expect(progressLine(p)).toBe("One finished today. One is due this week. One is overdue.");
  });
  it("is calm with no tasks", () => {
    const p = taskProgress([], "2026-11-18");
    expect(p.pct).toBe(0);
    expect(progressLine(p)).toBe("Nothing finished yet today.");
  });
  it("groups open tasks by category, with No category last and only when used", () => {
    const cats = [{ id: "a", name: "Billing" }, { id: "b", name: "Admin" }];
    const cols = boardColumns([T({ id: "1", categoryId: "a" }), T({ id: "2" }), T({ id: "3", categoryId: "a", completed: true })], cats, "2026-11-18");
    expect(cols.map((c) => [c.name, c.tasks.length])).toEqual([["Billing", 1], ["Admin", 0], ["No category", 1]]);
    expect(boardColumns([T({ categoryId: "a" })], cats, "2026-11-18").some((c) => c.name === "No category")).toBe(false);
  });
});
