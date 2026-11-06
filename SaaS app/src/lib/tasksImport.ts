// Pure planning for importing an exported set of tasks (scripts/import-tasks.ts). No database here.
export type PreparedTask = {
  title: string;
  notes: string;
  notesDropped?: boolean;
  categoryName: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  expiresAt: string | null;
  completed: boolean;
  completedAt: string | null;
  inToday: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
type Emp = { id: string; name: string; email: string | null };
type Cat = { id: string; name: string };
export type TaskImportPlan = {
  create: (PreparedTask & { assigneeId: string | null; categoryId: string | null })[];
  skippedDuplicates: number;
  /** Rows whose assignee/category could not be found. They would silently become empty, so the apply refuses them. */
  unmappedAssignees: { index: number; who: string }[];
  unmappedCategories: { index: number; name: string }[];
  notesDropped: number[];
};

const key = (title: string, createdAt: string | Date) => `${title}|${new Date(createdAt).toISOString()}`;

export function planTaskImport(rows: PreparedTask[], emps: Emp[], cats: Cat[], existing: { title: string; createdAt: Date }[]): TaskImportPlan {
  const seen = new Set(existing.map((e) => key(e.title, e.createdAt)));
  const plan: TaskImportPlan = { create: [], skippedDuplicates: 0, unmappedAssignees: [], unmappedCategories: [], notesDropped: [] };
  rows.forEach((r, index) => {
    if (r.notesDropped) plan.notesDropped.push(index);
    if (seen.has(key(r.title, r.createdAt))) {
      plan.skippedDuplicates++;
      return;
    }
    let assigneeId: string | null = null;
    if (r.assigneeEmail || r.assigneeName) {
      const e = r.assigneeEmail ? emps.find((x) => (x.email ?? "").toLowerCase() === r.assigneeEmail!.toLowerCase()) : emps.find((x) => x.name === r.assigneeName);
      if (e) assigneeId = e.id;
      else plan.unmappedAssignees.push({ index, who: r.assigneeEmail ?? r.assigneeName ?? "?" });
    }
    let categoryId: string | null = null;
    if (r.categoryName) {
      const c = cats.find((x) => x.name === r.categoryName);
      if (c) categoryId = c.id;
      else plan.unmappedCategories.push({ index, name: r.categoryName });
    }
    plan.create.push({ ...r, assigneeId, categoryId });
  });
  return plan;
}
