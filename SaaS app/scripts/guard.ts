// Import first in every script that touches the database:  import { guard } from "./guard"; guard({ name: "import-todo" });
// Refuses (exit 1) on an APP_ENV / database mismatch, and on production unless --allow-prod and PROD_CONFIRM match.
import { scriptVerdict, describeTarget, type ScriptPolicy } from "../src/lib/envGuard";

export function guard(policy: ScriptPolicy): void {
  const v = scriptVerdict(process.env, process.argv.slice(2), policy);
  if (!v.ok) {
    console.error(`REFUSED: ${v.reason}`);
    process.exit(1);
  }
  const t = describeTarget(process.env);
  console.error(`[guard] ${policy.name}: APP_ENV=${t.env} target=${t.kind} host=${t.host} db=${t.database}`);
}
