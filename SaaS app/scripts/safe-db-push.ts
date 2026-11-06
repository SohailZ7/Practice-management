// `npm run db:push`: prisma db push for local development only. Refuses --accept-data-loss and refuses any non-local database.
import { execFileSync } from "node:child_process";
import { describeTarget, envMismatch } from "../src/lib/envGuard";

const t = describeTarget(process.env);
const bad = envMismatch(process.env);
if (bad || t.kind !== "local" || process.argv.some((a) => /accept-data-loss|force-reset/.test(a))) {
  console.error(`REFUSED: db:push is for a local database only (${bad ?? `target is ${t.kind}`}). Use npm run schema:apply (gated) for shared databases.`);
  process.exit(1);
}
execFileSync("npx", ["prisma", "db", "push"], { stdio: "inherit" });
