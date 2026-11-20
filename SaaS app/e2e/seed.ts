// Fills the throwaway regression database with SYNTHETIC data only (names like "Test Alpha", @bbc.invalid emails).
// Run by e2e/global-setup.ts with the E2E environment. Refuses any database that is not the local practice_regress one.
import { db } from "../src/lib/db";
import { ADMIN_EMAIL, STAFF_EMAIL, E2E_DB_NAME } from "./env";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || !url.endsWith("/" + E2E_DB_NAME) || process.env.APP_ENV !== "development") {
  console.error("REFUSED: the screen-test seed only runs against the local " + E2E_DB_NAME + " database.");
  process.exit(1);
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const day = (offset: number) => { const d = new Date(today); d.setDate(d.getDate() + offset); return iso(d); };

async function main() {
  const admin = await db.user.create({ data: { email: ADMIN_EMAIL, name: "E2E Admin", role: "ADMIN", ledgerApprover: true, feedbackApprover: true } });
  const staff = await db.user.create({ data: { email: STAFF_EMAIL, name: "E2E Staff", role: "STAFF" } });
  for (const m of ["schedule", "tasks", "employees", "billing", "ledger", "notes"]) await db.moduleAccess.create({ data: { userId: staff.id, module: m, level: "view" } });

  const emps = await Promise.all(["Alex Tester", "Bailey Sample", "Casey Fixture"].map((name, i) => db.employee.create({ data: { name, title: "Synthetic " + i, email: `emp${i}@bbc.invalid`, phone: "555-0100" } })));
  const provs = await Promise.all([
    db.provider.create({ data: { name: "Dr Test One", employeeId: emps[0].id, hours: "Mon-Fri 8-4" } }),
    db.provider.create({ data: { name: "Dr Test Two", employeeId: emps[1].id } }),
  ]);
  for (const [i, n] of ["Track 1 IOP", "Track 2 IOP", "PM IOP"].entries()) await db.trackDef.create({ data: { name: n, startTime: "9:00", endTime: "12:00", sortOrder: i } });
  for (const n of ["Follow-up", "Evaluation", "DC Orders Only"]) await db.entryType.create({ data: { name: n } });
  const progs = await Promise.all(["IOP", "PHP"].map((name) => db.program.create({ data: { name } })));

  const patients: Awaited<ReturnType<typeof db.patient.create>>[] = [];
  for (const [i, n] of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].entries())
    patients.push(await db.patient.create({ data: { lastName: "Test" + n, firstName: "Pat", mrn: `E2E-${100 + i}`, createdById: admin.id, dob: "1990-01-01", sex: "F" } }));
  await db.patientAdmission.create({ data: { patientId: patients[0].id, admitDate: day(-5), createdByEmail: ADMIN_EMAIL } });

  const statuses = ["scheduled", "seen", "no_show", "cancelled", "note_signed"];
  const visits: Awaited<ReturnType<typeof db.visit.create>>[] = [];
  for (const [i, p] of patients.entries()) {
    visits.push(await db.visit.create({ data: { patientId: p.id, visitDate: day(0), appointmentType: "Follow-up", program: "IOP", apptTime: `${9 + i}:00`, startTime: `${9 + i}:00`.padStart(5, "0"), providerName: provs[i % 2].name, providerId: provs[i % 2].id, status: statuses[i], section: i === 0 ? "PSYCH_EVAL" : "TRACK", trackName: i === 0 ? null : "Track 1 IOP", createdByEmail: ADMIN_EMAIL } }));
  }
  await db.visit.create({ data: { patientId: patients[0].id, visitDate: day(-1), appointmentType: "Evaluation", program: "IOP", apptTime: "10:00", providerName: provs[0].name, providerId: provs[0].id, status: "seen", createdByEmail: ADMIN_EMAIL } });
  await db.visitNote.create({ data: { visitId: visits[0].id, body: "Synthetic visit note for layout checks.", authorEmail: ADMIN_EMAIL, authorName: "E2E Admin" } });

  // Billing encounters in every stage (draft, submitted, verified, entered, incorrect).
  const enc = (i: number, extra: Record<string, unknown> = {}) => db.encounter.create({ data: { patientId: patients[i].id, encounterDate: day(-i), programId: progs[i % 2].id, icd10Codes: ["F32.9"], chargeCode: "99213", createdById: admin.id, ...extra } });
  await enc(0);
  await enc(1, { submittedAt: new Date(), submittedById: admin.id });
  await enc(2, { submittedAt: new Date(), submittedById: admin.id, verifiedAt: new Date(), verifiedById: admin.id });
  await enc(3, { getixEntered: true, getixEnteredAt: new Date(), getixEnteredById: admin.id });
  await enc(4, { incorrectAt: new Date(), incorrectById: admin.id, incorrectNote: "Synthetic: wrong code" });
  await db.billingFile.create({ data: { name: "synthetic-report.csv", mime: "text/csv", size: 9, data: Buffer.from("a,b\n1,2\n"), uploadedByEmail: ADMIN_EMAIL } });

  // Tasks: open, done, high priority, long title, with an update.
  const cats = await Promise.all(["Admin", "Clinical"].map((name, i) => db.category.create({ data: { name, sortOrder: i } })));
  const long = "A deliberately long synthetic task title used to check that rows wrap or truncate without breaking the table layout " + "word ".repeat(12);
  const tasks: Awaited<ReturnType<typeof db.task.create>>[] = [];
  for (const [i, title] of ["Call the synthetic vendor", long, "File synthetic forms", "Review synthetic report", "Done synthetic item"].entries())
    tasks.push(await db.task.create({ data: { title, categoryId: cats[i % 2].id, assigneeId: emps[i % 3].id, dueDate: day(i - 1), priority: i === 1 ? "high" : "normal", status: i === 2 ? "in_progress" : "not_started", completed: i === 4, completedAt: i === 4 ? new Date() : null, inToday: i === 0, sortOrder: i } }));
  await db.taskUpdate.create({ data: { taskId: tasks[0].id, authorEmail: ADMIN_EMAIL, authorName: "E2E Admin", body: "Synthetic update." } });
  await db.recurringTask.create({ data: { title: "Weekly synthetic check", assigneeId: emps[0].id, frequency: "weekly", weekday: 0, startDate: day(-30), createdById: admin.id } });

  // Ledger: cash in, cash out, a long comment, a pending and a rejected expense.
  const lc = await Promise.all(["Supplies", "Rent", "Services"].map((name, i) => db.ledgerCategory.create({ data: { name, sortOrder: i } })));
  const lm = await Promise.all(["Cash", "Check", "Card"].map((name, i) => db.ledgerMethod.create({ data: { name, sortOrder: i } })));
  const lp = await Promise.all(["Alex Tester", "Bailey Sample"].map((name, i) => db.ledgerParty.create({ data: { name, sortOrder: i } })));
  const entries: { cashIn?: number; cashOut?: number; comments: string; approvalStatus?: string }[] = [
    { cashIn: 150000, comments: "Synthetic deposit" },
    { cashOut: 4500, comments: "Synthetic supplies" },
    { cashOut: 120000, comments: "Synthetic rent with a deliberately long comment to check wrapping in the grid. ".repeat(3) },
    { cashOut: 2500, comments: "", approvalStatus: "pending" },
    { cashOut: 999, comments: "Synthetic rejected", approvalStatus: "rejected" },
  ];
  for (const [i, e] of entries.entries()) await db.ledgerEntry.create({ data: { date: day(-i), partyId: lp[i % 2].id, categoryId: lc[i % 3].id, methodId: lm[i % 3].id, createdById: admin.id, ...e } });

  // Feedback in several stages.
  for (const [i, s] of ["new", "triaged", "building", "on_staging", "tested", "released", "rejected"].entries())
    await db.feedbackItem.create({ data: { kind: i % 2 ? "BUG" : "FEEDBACK", title: `Synthetic feedback ${i}`, description: "Synthetic description.", authorId: admin.id, status: s } });

  // Timesheets
  const te = await db.timesheetEmployee.create({ data: { name: "Alex Tester" } });
  await db.timesheetEntry.create({ data: { employeeId: te.id, date: day(-1), startMin: 540, endMin: 1020, rateCents: 2300, createdById: admin.id } });
  console.log("seeded");
}
main().then(() => process.exit(0), (e) => { console.error("seed failed", e); process.exit(1); });
