// STAGING ONLY. Removes the click-through test data: patient "Testpatient, Qa" with its encounters and history, and the
// program "QA Program". Dry run by default; pass --apply to delete. Refuses unless APP_ENV=staging.
import { db } from "../src/lib/db";

if (process.env.APP_ENV !== "staging") { console.error("Refusing: APP_ENV is not staging."); process.exit(2); }
const apply = process.argv.includes("--apply");

async function main() {
  const patients = await db.patient.findMany({ where: { lastName: "Testpatient", firstName: "Qa" }, select: { id: true } });
  const pids = patients.map((p) => p.id);
  const encounters = await db.encounter.findMany({ where: { patientId: { in: pids } }, select: { id: true } });
  const eids = encounters.map((e) => e.id);
  const program = await db.program.findUnique({ where: { name: "QA Program" }, select: { id: true, _count: { select: { encounters: true } } } });
  const programOnlyOurs = program ? program._count.encounters === encounters.length || program._count.encounters === 0 : false;
  console.log(JSON.stringify({ apply, patients: pids.length, encounters: eids.length, programFound: !!program, programSafeToDelete: programOnlyOurs }));
  if (!apply) return;
  await db.billingHistory.deleteMany({ where: { entityId: { in: [...eids, ...pids] } } });
  await db.encounter.deleteMany({ where: { id: { in: eids } } });
  await db.patient.deleteMany({ where: { id: { in: pids } } });
  if (program && programOnlyOurs) await db.program.delete({ where: { id: program.id } });
  console.log("cleaned");
}
main().finally(() => db.$disconnect());
