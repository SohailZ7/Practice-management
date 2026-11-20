import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blockedPatchKeys, taskLevel } from "../src/lib/taskAccess";

const base = { moduleEdit: true, meId: "me", editIds: [] as string[] };
describe("task rights (everyone sees all, edits need admin)", () => {
  it("admin and edit-grant holders change everything", () => {
    expect(taskLevel({ ...base, isAdmin: true, assigneeId: "x" })).toBe("full");
    expect(taskLevel({ ...base, isAdmin: false, editIds: ["x"], assigneeId: "x" })).toBe("full");
  });
  it("on your own task: status, Today, assign only", () => {
    const l = taskLevel({ ...base, isAdmin: false, assigneeId: "me" });
    expect(l).toBe("own");
    expect(blockedPatchKeys(l, { status: "done", inToday: true, assigneeId: "x" })).toEqual([]);
    expect(blockedPatchKeys(l, { title: "x", dueDate: "2026-12-01", notes: "n", priority: "high" })).toEqual(["title", "dueDate", "notes", "priority"]);
  });
  it("on someone else's task: assign only", () => {
    const l = taskLevel({ ...base, isAdmin: false, assigneeId: "other" });
    expect(l).toBe("assign");
    expect(blockedPatchKeys(l, { assigneeId: "me" })).toEqual([]);
    expect(blockedPatchKeys(l, { status: "done" })).toEqual(["status"]);
  });
  it("no Tasks edit access means nothing", () => {
    expect(taskLevel({ ...base, moduleEdit: false, isAdmin: false, assigneeId: "me" })).toBe("none");
  });
  it("the server action enforces it and the screen lists every tab", () => {
    expect(readFileSync("src/app/tasks/actions.ts", "utf8")).toContain("blockedPatchKeys(level");
    expect(readFileSync("src/app/tasks/page.tsx", "utf8")).toContain("webViewIds: allowed");
  });
});
