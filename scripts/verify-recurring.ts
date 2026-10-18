// End-to-end check of recurring tasks against the real database, using synthetic data that it
// removes afterwards:  npx tsx scripts/verify-recurring.ts
import { PrismaClient } from "@prisma/client";
import { ensureRecurringTasks, reconcileRecurring } from "../src/lib/recurring";

const db = new PrismaClient();
let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
};

async function main() {
  const [muntaha, razak] = await Promise.all([
    db.employee.findFirstOrThrow({ where: { name: "Muntaha" } }),
    db.employee.findFirstOrThrow({ where: { name: "Razak Ahmed" } }),
  ]);
  const admin = await db.user.findFirstOrThrow({ where: { email: "sohail30@gmail.com" } });

  const created: string[] = []; // only these synthetic recurring tasks are ever generated here
  const dates = async (id: string, onlyOpen = false) =>
    (await db.task.findMany({ where: { recurringId: id, ...(onlyOpen ? { completed: false } : {}) }, orderBy: { dueDate: "asc" } })).map((t) => t.dueDate);
  const make = async (title: string, data: object) =>
    db.recurringTask.create({ data: { title, assigneeId: muntaha.id, frequency: "WEEKLY", weekday: 0, startDate: "2026-10-12", createdById: admin.id, ...data } as never });
  const edit = async (id: string, data: object, today: string, oldTitle?: string) => {
    await db.recurringTask.update({ where: { id }, data });
    await reconcileRecurring(id, oldTitle, today);
    await ensureRecurringTasks(today, created);
  };
  try {
    // 1. The reported bug: start date moved later removes the task, and it appears on its specific day.
    let r = await make("ZZ weekly Monday", { startDate: "2026-10-12" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-19");
    await ensureRecurringTasks("2026-10-19", created); // Monday
    check("1a created on its day (Monday 10/19); earlier Monday 10/12 is not back-filled", await dates(r.id), ["2026-10-19"]);
    await edit(r.id, { startDate: "2026-10-26" }, "2026-10-19");
    check("1b start date moved to 10/26: the 10/19 task is gone from the board", await dates(r.id), []);
    await ensureRecurringTasks("2026-10-22", created);
    check("1c nothing before the start date", await dates(r.id), []);
    await ensureRecurringTasks("2026-10-26", created);
    check("1d it shows up on the specific day, 10/26", await dates(r.id), ["2026-10-26"]);
    await ensureRecurringTasks("2026-10-26", created);
    check("1e running again creates no duplicate", await dates(r.id), ["2026-10-26"]);

    // 2. Start date moved back so today qualifies. (Step 1 simulated moving forward to 10/26; go back to
    //    10/19 with a clean slate so the checks below don't depend on time travelling backwards.)
    await db.task.deleteMany({ where: { recurringId: r.id } });
    await edit(r.id, { startDate: "2026-10-26" }, "2026-10-19");
    await edit(r.id, { startDate: "2026-10-19" }, "2026-10-19");
    check("2  start moved back to 10/19 (today): the 10/26 task goes, today's appears", await dates(r.id), ["2026-10-19"]);

    // 3. A finished task is history: it stays when the start date moves later, and is not re-created.
    await db.task.updateMany({ where: { recurringId: r.id }, data: { completed: true, completedAt: new Date() } });
    await edit(r.id, { startDate: "2026-10-26" }, "2026-10-19");
    check("3a finished task stays", await dates(r.id), ["2026-10-19"]);
    await edit(r.id, { startDate: "2026-10-12" }, "2026-10-19");
    check("3b moving start back does not duplicate today's finished task", await dates(r.id), ["2026-10-19"]);
    await db.task.deleteMany({ where: { recurringId: r.id } });

    // 4. Weekday changed Monday -> Wednesday while today is Monday.
    r = await make("ZZ weekday change", { startDate: "2026-10-01" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-19");
    await ensureRecurringTasks("2026-10-19", created);
    check("4a Monday task exists", await dates(r.id), ["2026-10-19"]);
    await edit(r.id, { weekday: 2 }, "2026-10-19");
    check("4b changed to Wednesday: Monday's task removed, Wednesday 10/14 not back-filled", await dates(r.id), []);
    await ensureRecurringTasks("2026-10-21", created);
    check("4c Wednesday 10/21 task appears on the day", await dates(r.id), ["2026-10-21"]);

    // 5. End date moved earlier than an open overdue task.
    r = await make("ZZ end date", { frequency: "DAILY", weekday: null, startDate: "2026-10-05" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-12");
    await ensureRecurringTasks("2026-10-12", created);
    await ensureRecurringTasks("2026-10-13", created);
    await ensureRecurringTasks("2026-10-14", created);
    check("5a weekday task per day the app was opened", await dates(r.id), ["2026-10-12", "2026-10-13", "2026-10-14"]);
    await edit(r.id, { endDate: "2026-10-13" }, "2026-10-14");
    check("5b end date 10/13: the open 10/14 task is removed", await dates(r.id), ["2026-10-12", "2026-10-13"]);
    await ensureRecurringTasks("2026-10-20", created);
    check("5c nothing is created after the end date", await dates(r.id), ["2026-10-12", "2026-10-13"]);

    // 6. Daily is weekdays only: weekend creates nothing.
    r = await make("ZZ daily", { frequency: "DAILY", weekday: null, startDate: "2026-10-01" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-16");
    await ensureRecurringTasks("2026-10-16", created); // Friday
    await ensureRecurringTasks("2026-10-17", created); // Saturday
    await ensureRecurringTasks("2026-10-18", created); // Sunday
    check("6a Friday task only; Saturday and Sunday create nothing", await dates(r.id), ["2026-10-16"]);
    await ensureRecurringTasks("2026-10-19", created);
    check("6b Monday task appears", await dates(r.id), ["2026-10-16", "2026-10-19"]);

    // 7. Idle: nobody opened the app on Monday; the missed task still appears when someone does (once).
    r = await make("ZZ idle", { startDate: "2026-10-01" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-14");
    await ensureRecurringTasks("2026-10-14", created);
    check("7a weekly Monday created nothing on a Wednesday before the first Monday after creation", await dates(r.id), []);
    await ensureRecurringTasks("2026-10-22", created); // Thursday after Monday 10/19
    check("7b the missed Monday 10/19 appears once the app is opened, only the latest one", await dates(r.id), ["2026-10-19"]);

    // 8. Paused: the future task is removed, the current one stays; resuming does not back-fill.
    r = await make("ZZ pause", { frequency: "DAILY", weekday: null, startDate: "2026-10-01" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-19");
    await ensureRecurringTasks("2026-10-19", created);
    await edit(r.id, { active: false }, "2026-10-19");
    check("8a paused: today's task stays", await dates(r.id), ["2026-10-19"]);
    await ensureRecurringTasks("2026-10-21", created);
    check("8b paused: nothing new is created", await dates(r.id), ["2026-10-19"]);
    await edit(r.id, { active: true }, "2026-10-22");
    check("8c resumed on 10/22: today's task appears, the paused days are not back-filled", await dates(r.id), ["2026-10-19", "2026-10-22"]);

    // 9. Reassigning moves open tasks; renaming updates open tasks; finished ones keep their owner.
    r = await make("ZZ old title", { frequency: "DAILY", weekday: null, startDate: "2026-10-01" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-19");
    await ensureRecurringTasks("2026-10-19", created);
    await ensureRecurringTasks("2026-10-20", created);
    const first = (await db.task.findMany({ where: { recurringId: r.id }, orderBy: { dueDate: "asc" } }))[0];
    await db.task.update({ where: { id: first.id }, data: { completed: true, completedAt: new Date() } });
    await edit(r.id, { assigneeId: razak.id, title: "ZZ new title" }, "2026-10-20", "ZZ old title");
    const tasks = await db.task.findMany({ where: { recurringId: r.id }, orderBy: { dueDate: "asc" } });
    check("9a finished task keeps its owner and title", [tasks[0].assigneeId === muntaha.id, tasks[0].title], [true, "ZZ old title"]);
    check("9b open task follows the new assignee and title", [tasks[1].assigneeId === razak.id, tasks[1].title], [true, "ZZ new title"]);

    // 10. Monthly: day changed after a task was generated.
    r = await make("ZZ monthly", { frequency: "MONTHLY", weekday: null, dayOfMonth: 15, startDate: "2026-09-01" });
    created.push(r.id);
    await reconcileRecurring(r.id, undefined, "2026-10-15");
    await ensureRecurringTasks("2026-10-15", created);
    check("10a monthly 15th created on the 15th", await dates(r.id), ["2026-10-15"]);
    await edit(r.id, { dayOfMonth: 20 }, "2026-10-16");
    check("10b changed to the 20th: the 15th's open task is removed, nothing back-filled", await dates(r.id), []);
    await ensureRecurringTasks("2026-10-20", created);
    check("10c the 20th appears on the day", await dates(r.id), ["2026-10-20"]);
  } finally {
    await db.task.deleteMany({ where: { recurringId: { in: created } } });
    await db.recurringTask.deleteMany({ where: { id: { in: created } } });
  }
  console.log(failures === 0 ? "\nAll recurring checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
