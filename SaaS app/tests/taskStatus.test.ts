import { describe, expect, it } from "vitest";
import { isTaskStatus, taskStatus, taskStatusFields, TASK_STATUSES, TASK_STATUS_LABEL } from "../src/lib/taskTypes";
import { parseTaskBody, toTaskOut, parseListQuery } from "../src/lib/mcpApi/shape";

describe("task states", () => {
  it("has the three states with the spec labels", () => {
    expect(TASK_STATUSES.map((s) => TASK_STATUS_LABEL[s])).toEqual(["Not started", "In progress", "Done"]);
    expect(isTaskStatus("done")).toBe(true);
    expect(isTaskStatus("open")).toBe(false);
  });
  it("migration mapping: old done flag -> Done, open rows -> Not started, in progress only while open", () => {
    expect(taskStatus({ completed: true })).toBe("done");
    expect(taskStatus({ completed: true, status: "in_progress" })).toBe("done");
    expect(taskStatus({ completed: false })).toBe("not_started");
    expect(taskStatus({ completed: false, status: "not_started" })).toBe("not_started");
    expect(taskStatus({ completed: false, status: "done" })).toBe("not_started"); // reopened by the sync
    expect(taskStatus({ completed: false, status: "in_progress" })).toBe("in_progress");
  });
  it("moving to Done stamps completedAt once; leaving Done clears it", () => {
    const now = new Date("2026-11-18T10:00:00Z");
    const was = new Date("2026-11-01T10:00:00Z");
    expect(taskStatusFields("done", { completed: false, completedAt: null }, now)).toEqual({ status: "done", completed: true, completedAt: now });
    expect(taskStatusFields("done", { completed: true, completedAt: was }, now).completedAt).toBe(was);
    expect(taskStatusFields("in_progress", { completed: true, completedAt: was }, now)).toEqual({ status: "in_progress", completed: false, completedAt: null });
    expect(taskStatusFields("not_started", { completed: false, completedAt: null }, now).completed).toBe(false);
  });
});

describe("tasks API status", () => {
  it("done=true still works and status is accepted", () => {
    expect(parseTaskBody({ done: true }, "update").done).toBe(true);
    expect(parseTaskBody({ status: "in_progress" }, "update").status).toBe("in_progress");
    expect(() => parseTaskBody({ status: "blocked" }, "update")).toThrow();
    expect(() => parseTaskBody({ status: "done", done: false }, "update")).toThrow();
    expect(() => parseTaskBody({ title: "x", status: "done" }, "create")).toThrow();
  });
  it("output carries status and the done flag; list accepts the new filters", () => {
    const row = { id: "1", title: "t", notes: "", assigneeId: null, categoryId: null, dueDate: null };
    expect(toTaskOut({ ...row, completed: true }, { withNotes: false })).toMatchObject({ done: true, status: "done" });
    expect(toTaskOut({ ...row, completed: false, status: "in_progress" }, { withNotes: false })).toMatchObject({ done: false, status: "in_progress" });
    expect(parseListQuery(new URLSearchParams("status=in_progress")).status).toBe("in_progress");
    expect(parseListQuery(new URLSearchParams("status=not_started")).status).toBe("not_started");
    expect(parseListQuery(new URLSearchParams("")).status).toBe("open");
  });
});
