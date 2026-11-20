import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { autoCompare, isTaskPriority, splitTasks, taskPriority } from "../src/lib/taskTypes";

const t = (id: string, priority: string, dueDate: string | null, sortOrder: number) => ({ id, completed: false, dueDate, expiresAt: null, inToday: false, sortOrder, priority: taskPriority(priority) });

describe("task priority", () => {
  it("accepts only high, normal, low; anything else reads as normal", () => {
    expect(isTaskPriority("high")).toBe(true);
    expect(isTaskPriority("urgent")).toBe(false);
    expect(taskPriority(undefined)).toBe("normal");
    expect(taskPriority("zzz")).toBe("normal");
  });
  it("auto sort: priority first, then due date (no date last), then manual order", () => {
    const list = [t("a", "normal", "2026-12-01", 1), t("b", "low", "2026-11-25", 2), t("c", "high", "2026-12-20", 3), t("d", "high", "2026-12-05", 4), t("e", "normal", null, 0)];
    expect([...list].sort(autoCompare).map((x) => x.id)).toEqual(["d", "c", "a", "e", "b"]);
  });
  it("splitTasks: auto reorders the Backlog, manual keeps the saved drag order", () => {
    const list = [t("a", "low", "2027-01-01", 1), t("b", "high", "2027-02-01", 2)];
    expect(splitTasks(list, "2026-11-19", true).backlog.map((x) => x.id)).toEqual(["b", "a"]);
    expect(splitTasks(list, "2026-11-19", false).backlog.map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("schema and update action carry priority additively", () => {
    expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/priority\s+String\s+@default\("normal"\)/);
    expect(readFileSync("src/app/tasks/actions.ts", "utf8")).toContain('throw new Error("Invalid priority")');
  });
});
