// Row counts per table, counts only (no PHI). Take one before a schema change or promotion and compare after.
//   npm run counts -- --out before.json        write a snapshot
//   npm run counts -- --compare before.json    exit 1 if any table that existed before has fewer rows now
import { readFileSync, writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { guard } from "./guard";
guard({ name: "row-counts" });

async function main() {
  const db = new PrismaClient();
  const counts: Record<string, number> = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    const delegate = (db as unknown as Record<string, { count?: () => Promise<number> }>)[m.name[0].toLowerCase() + m.name.slice(1)];
    if (delegate?.count) counts[m.name] = await delegate.count();
  }
  await db.$disconnect();
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = arg("--out"), cmp = arg("--compare");
  if (out) writeFileSync(out, JSON.stringify(counts, null, 1));
  if (cmp) {
    const before = JSON.parse(readFileSync(cmp, "utf8")) as Record<string, number>;
    const lost = Object.entries(before).filter(([k, n]) => (counts[k] ?? 0) < n);
    for (const [k, n] of Object.entries(before)) if (counts[k] !== n) console.log(`${k}: ${n} -> ${counts[k] ?? "missing"}`);
    if (lost.length) { console.log(`COUNTS: FAIL, fewer rows in ${lost.map(([k]) => k).join(", ")}`); process.exit(1); }
    console.log("COUNTS: PASS (no table lost rows)");
  } else console.log(JSON.stringify(counts));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
