// Imports tasks from a Sohail Todo App state export ({ categories, todos }) into the Tasks module.
//
//   npx tsx scripts/import-todo.ts <state.json> --category "B & BC" --assignee sohail30@gmail.com [--dry-run]
//
// Tasks already present (same title, category and assignee) are skipped, so it is safe to re-run.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { detectLinkType, linkTypeMeta, normalizeUrl } from "../src/lib/links";

type TodoState = {
  categories: { id: string; name: string }[];
  todos: {
    title: string;
    categoryId: string | null;
    dueDate: string | null;
    completed: boolean;
    completedAt?: number | null;
    createdAt?: number;
    inToday: boolean;
    links?: { url: string }[];
  }[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv[2];
  const categoryName = arg("category");
  const assigneeEmail = arg("assignee")?.toLowerCase();
  const dryRun = process.argv.includes("--dry-run");
  if (!file || !categoryName || !assigneeEmail) {
    console.error('Usage: tsx scripts/import-todo.ts <state.json> --category "B & BC" --assignee <employee email> [--dry-run]');
    process.exit(1);
  }

  const db = new PrismaClient();
  try {
    const state = JSON.parse(readFileSync(file, "utf8")) as TodoState;
    const source = state.categories.find((c) => c.name === categoryName);
    if (!source) throw new Error(`Category "${categoryName}" not found in ${file}`);
    const assignee = await db.employee.findUnique({ where: { email: assigneeEmail } });
    if (!assignee) throw new Error(`No employee with email ${assigneeEmail}`);

    const category = dryRun
      ? await db.category.findUnique({ where: { name: categoryName } })
      : await db.category.upsert({
          where: { name: categoryName },
          update: {},
          create: { name: categoryName, sortOrder: await db.category.count() },
        });
    const top = await db.task.aggregate({ _max: { sortOrder: true } });
    let order = (top._max.sortOrder ?? 0) + 1;

    let created = 0;
    let skipped = 0;
    for (const t of state.todos.filter((x) => x.categoryId === source.id)) {
      const exists = category
        ? await db.task.findFirst({ where: { title: t.title, categoryId: category.id, assigneeId: assignee.id } })
        : null;
      if (exists) {
        skipped++;
        continue;
      }
      if (!dryRun && category) {
        const links = (t.links ?? []).flatMap((l) => {
          const url = normalizeUrl(l.url);
          if (!url) return [];
          const type = detectLinkType(url);
          return [{ url, type, label: linkTypeMeta(type).label }];
        });
        await db.task.create({
          data: {
            title: t.title,
            categoryId: category.id,
            assigneeId: assignee.id,
            dueDate: t.dueDate,
            completed: t.completed,
            completedAt: t.completed && t.completedAt ? new Date(t.completedAt) : null,
            inToday: t.inToday,
            sortOrder: order++,
            links: { create: links },
          },
        });
      }
      created++;
    }
    console.log(`${dryRun ? "[dry run] would import" : "Imported"} ${created} tasks, skipped ${skipped} already present.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
