// Backup gate (safeguard 8 gate 1): compares the TABLE_COUNTS of production with those of the restored scratch database.
// Pure, no database. Counts only.
//   npx tsx scripts/unify-compare-counts.ts '<prod TABLE_COUNTS json>' '<scratch TABLE_COUNTS json>'
import { backupGate } from "../src/lib/unify/gates";
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: unify-compare-counts.ts '<prod json>' '<scratch json>'"); process.exit(1); }
const g = backupGate(JSON.parse(a), JSON.parse(b));
console.log(`GATE backup: ${g.pass ? "PASS" : "FAIL"} (${g.detail})`);
process.exit(g.pass ? 0 : 1);
