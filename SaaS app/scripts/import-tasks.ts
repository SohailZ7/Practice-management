// Loads a prepared task set (see context/prod-task-import/prepare.mjs) into the Tasks module. Idempotent: a task with the
// same title and createdAt is skipped, so a re-run adds nothing. Notes are written through createDb(), so they are
// encrypted with the key of the environment this runs in.
//
//   npx tsx scripts/import-tasks.ts [file.json]                 dry run (also on prod: read only)
//   npx tsx scripts/import-tasks.ts [file.json] --apply [--allow-prod]   writes; on prod needs PROD_CONFIRM too
// Data comes from the file argument or IMPORT_B64 (gzip + base64). Prints counts and row numbers only, never content.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { guard } from "./guard";

const apply = process.argv.includes("--apply");
guard({ name: "import-tasks", readOnly: !apply }); // before anything touches the database

import { createDb } from "../src/lib/db";
import { planTaskImport, type PreparedTask } from "../src/lib/tasksImport";

function load(): PreparedTask[] {
  const file = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
  const raw = file ? readFileSync(file, "utf8") : process.env.IMPORT_B64 ? gunzipSync(Buffer.from(process.env.IMPORT_B64, "base64")).toString() : "";
  if (!raw) throw new Error("Provide a JSON file path or IMPORT_B64.");
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error("Expected a JSON array of tasks.");
  return rows as PreparedTask[];
}

async function main() {
  const db = createDb();
  try {
    const rows = load();
    const [emps, cats, existing] = await Promise.all([
      db.employee.findMany({ select: { id: true, name: true, email: true } }),
      db.category.findMany({ select: { id: true, name: true } }),
      db.task.findMany({ select: { title: true, createdAt: true } }),
    ]);
    const plan = planTaskImport(rows, emps, cats, existing);
    console.log(`file rows: ${rows.length}; tasks in this database BEFORE: ${existing.length}`);
    console.log(`would create: ${plan.create.length}; already present (skipped): ${plan.skippedDuplicates}`);
    console.log(`notes dropped (could not be decrypted at the source), row numbers: ${JSON.stringify(plan.notesDropped.map((i) => i + 1))}`);
    console.log(`UNMAPPED assignees (would become empty): ${plan.unmappedAssignees.length} ${JSON.stringify(plan.unmappedAssignees.map((u) => ({ row: u.index + 1, who: u.who })))}`);
    console.log(`UNMAPPED categories (would become empty): ${plan.unmappedCategories.length} ${JSON.stringify(plan.unmappedCategories.map((u) => ({ row: u.index + 1, name: u.name })))}`);
    if (!apply) {
      console.log("DRY RUN: nothing written.");
      return;
    }
    if (plan.unmappedAssignees.length || plan.unmappedCategories.length) throw new Error("Refusing to apply: fix the unmapped assignees/categories above first.");
    await db.$transaction(
      plan.create.map((t) =>
        db.task.create({
          data: {
            title: t.title,
            notes: t.notes,
            categoryId: t.categoryId,
            assigneeId: t.assigneeId,
            dueDate: t.dueDate,
            expiresAt: t.expiresAt,
            completed: t.completed,
            completedAt: t.completedAt ? new Date(t.completedAt) : null,
            inToday: t.inToday,
            sortOrder: t.sortOrder,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
          },
        }),
      ),
    );
    const after = await db.task.count();
    await db.auditLog.create({ data: { actorEmail: "script:import-tasks", action: "tasks.import", detail: `created=${plan.create.length} skipped=${plan.skippedDuplicates} before=${existing.length} after=${after}` } });
    console.log(`APPLIED: created ${plan.create.length}; tasks AFTER: ${after}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("import-tasks failed:", e instanceof Error ? e.message.slice(0, 300) : "unknown error");
  process.exitCode = 1;
});
