import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planTaskImport, type PreparedTask } from "@/lib/tasksImport";

const row = (o: Partial<PreparedTask> = {}): PreparedTask => ({
  title: "T", notes: "", categoryName: "B & BC", assigneeEmail: "a@x.com", assigneeName: null, dueDate: null, expiresAt: null,
  completed: false, completedAt: null, inToday: false, sortOrder: 1, createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...o,
});
const emps = [{ id: "e1", name: "A", email: "A@x.com" }, { id: "e2", name: "Dr Irfan", email: null }];
const cats = [{ id: "c1", name: "B & BC" }];

describe("planTaskImport", () => {
  it("maps by email (case-insensitive) and by name, and categories by name", () => {
    const p = planTaskImport([row(), row({ title: "U", assigneeEmail: null, assigneeName: "Dr Irfan" })], emps, cats, []);
    expect(p.create.map((c) => [c.assigneeId, c.categoryId])).toEqual([["e1", "c1"], ["e2", "c1"]]);
  });
  it("is idempotent: same title and createdAt is skipped", () => {
    const p = planTaskImport([row()], emps, cats, [{ title: "T", createdAt: new Date("2026-11-01T10:00:00Z") }]);
    expect(p.create).toHaveLength(0);
    expect(p.skippedDuplicates).toBe(1);
  });
  it("lists unmapped assignees and categories instead of silently emptying them", () => {
    const p = planTaskImport([row({ assigneeEmail: "nobody@x.com", categoryName: "Nope" })], emps, cats, []);
    expect(p.unmappedAssignees).toEqual([{ index: 0, who: "nobody@x.com" }]);
    expect(p.unmappedCategories).toEqual([{ index: 0, name: "Nope" }]);
  });
  it("reports dropped notes", () => expect(planTaskImport([row({ notesDropped: true })], emps, cats, []).notesDropped).toEqual([0]));
});

describe("import-tasks script", () => {
  const src = readFileSync("scripts/import-tasks.ts", "utf8");
  it("runs the guard before any database import, uses the encrypting client and refuses unmapped rows", () => {
    expect(src.indexOf("guard({")).toBeLessThan(src.indexOf("async function main"));
    expect(src).toContain("createDb()");
    expect(src).toContain("Refusing to apply");
    expect(src).not.toMatch(/new PrismaClient/);
  });
});
