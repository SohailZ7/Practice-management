import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toTaskDTO } from "../src/lib/taskTypes";

describe("task updates", () => {
  it("schema adds TaskUpdate additively with a seenAt for the assignee badge", () => {
    const s = readFileSync("prisma/schema.prisma", "utf8");
    expect(s).toMatch(/model TaskUpdate \{[\s\S]*seenAt\s+DateTime\?[\s\S]*onDelete: Cascade/);
  });
  it("DTO maps updates and seen state", () => {
    const row = { id: "t", title: "x", notes: "", categoryId: null, assigneeId: null, dueDate: null, expiresAt: null, completed: false, status: "not_started", priority: "normal", completedAt: null, inToday: false, sortOrder: 0, recurringId: null, links: [], updates: [{ id: "u1", authorName: "Test", body: "b", createdAt: new Date(5), seenAt: null }, { id: "u2", authorName: "Test", body: "c", createdAt: new Date(6), seenAt: new Date(7) }] };
    const dto = toTaskDTO(row as never);
    expect(dto.updates!.map((u) => u.seen)).toEqual([false, true]);
  });
  it("posting is phi-checked and audited without text; only the assignee clears the badge; links need full rights", () => {
    const a = readFileSync("src/app/tasks/actions.ts", "utf8");
    expect(a).toMatch(/addTaskUpdate[\s\S]*phiCheck\(user, taskId, \[body\]/);
    expect(a).toContain('audit(user.email, "task.update.add", `task ${taskId}`)');
    expect(a).toMatch(/assignee\?\.email !== user\.email\) return/);
    expect(a).toMatch(/addTaskLink[\s\S]*requireFullRights/);
  });
});
