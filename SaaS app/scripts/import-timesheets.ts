// Command-line twin of the Timesheets upload page: the same service, so results match. Idempotent.
//   npx tsx scripts/import-timesheets.ts file.json [--apply]      (dry run unless --apply)
// Prints counts and discrepancies only, never the rows.
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { runImport } from "../src/lib/timesheets/importService";
import { guard } from "./guard";
guard({ name: "import-timesheets" });

async function main() {
  const file = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
  const raw = file ? readFileSync(file, "utf8") : process.env.IMPORT_JSON;
  if (!raw) throw new Error("Provide a JSON file path or set IMPORT_JSON.");
  const admin = await db.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No active admin to attribute the import to.");
  const r = await runImport({ id: admin.id, email: admin.email }, raw, { apply: process.argv.includes("--apply") });
  console.log(r.applied ? "APPLIED" : "DRY RUN", r.fatal ?? "");
  console.log("entries:", JSON.stringify(r.entries));
  console.log("payments:", JSON.stringify(r.payments));
  console.log(`needs a date: ${r.needsDate.length}; discrepancies: ${r.discrepancies.length}; errors: ${r.errors.length}`);
  for (const d of r.discrepancies) console.log(`  ${d.employee} ${d.date} ${d.start}-${d.end} ${d.field}: computed ${d.computed}, source ${d.sheet}`);
  for (const e of r.errors) console.log(`  ${e}`);
}

main()
  .catch((e) => {
    console.error("import failed:", e instanceof Error ? e.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
