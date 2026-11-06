// Admin script: writes the training export (JSONL) to a file. Needs DATABASE_URL (and PHI_ENCRYPTION_KEY if set).
//   npx tsx scripts/export-notes-training.ts out/notes-training.jsonl
//
// THE OUTPUT CONTAINS PHI: full visit transcripts and the clinical values of each document. Keep it inside the
// practice's controlled environment. Before any of it goes to a fine-tuning service you need (1) a BAA with that
// service and (2) a reviewed de-identification step. This script does not de-identify and does not start any training.
import fs from "node:fs";
import path from "node:path";
import { trainingRecords } from "../src/lib/notes/docService";
import { guard } from "./guard";
guard({ name: "export-notes-training" });

async function main() {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: tsx scripts/export-notes-training.ts <output.jsonl>");
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const fd = fs.openSync(out, "w", 0o600);
  let n = 0;
  for await (const r of trainingRecords()) {
    fs.writeSync(fd, `${JSON.stringify(r)}\n`);
    n++;
  }
  fs.closeSync(fd);
  console.error(`Wrote ${n} document(s) to ${out}. This file contains PHI: do not share or upload it without a BAA and de-identification review.`);
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : "export failed"); process.exit(1); });
