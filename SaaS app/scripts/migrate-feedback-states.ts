// One-time, optional: rewrites old Feedback status words to the new states (build_it -> triaged + accepted, approved -> tested,
// shipped -> released, needs_changes -> building). The app already reads old words as the new ones, so this is tidying, not a
// requirement. Data only (no schema change). Idempotent; one history row per item changed. Dry run unless --apply.
//   tsx scripts/migrate-feedback-states.ts            (dry run: counts per old word)
//   tsx scripts/migrate-feedback-states.ts --apply    (staging; production also needs --allow-prod and PROD_CONFIRM)
import { PrismaClient } from "@prisma/client";
import { guard } from "./guard";
import { LEGACY_MAP, LEGACY_STATUSES } from "../src/lib/feedback/workflow";

const apply = process.argv.includes("--apply");
guard({ name: "migrate-feedback-states", readOnly: !apply });

async function main() {
  const db = new PrismaClient();
  try {
    for (const old of LEGACY_STATUSES) {
      const { status, triage } = LEGACY_MAP[old];
      const rows = await db.feedbackItem.findMany({ where: { status: old }, select: { id: true } });
      console.log(`${old} -> ${status}${triage ? ` + ${triage}` : ""}: ${rows.length} item(s)${apply ? "" : " (dry run)"}`);
      if (!apply) continue;
      for (const { id } of rows) {
        await db.$transaction([
          db.feedbackItem.update({ where: { id }, data: { status, ...(triage ? { triageOutcome: triage } : {}) } }),
          db.feedbackEvent.create({ data: { itemId: id, actorName: "system", actorKind: "system", field: "status", fromValue: old, toValue: status } }),
        ]);
      }
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
