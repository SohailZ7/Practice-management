import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PEOPLE = [
  { name: "Sohail", email: "sohail30@gmail.com", role: "ADMIN", title: "Administrator" },
  { name: "Dr Khalid", email: "khalid21631@gmail.com", role: "PROVIDER", title: "Doctor" },
  { name: "Razak Ahmed", email: "razakahmed19@gmail.com", role: "STAFF", title: "Office Manager" },
  { name: "Muntaha", email: "muntahastar@gmail.com", role: "STAFF", title: "Office Manager" },
];

const MODULES = ["schedule", "tasks", "employees", "billing", "ledger"];

// Non-admins start with edit on schedule and tasks, view on employees. Admin changes this in the app.
const DEFAULT_LEVEL: Record<string, string> = { schedule: "edit", tasks: "edit", employees: "view", billing: "none", ledger: "none" };
// Dr Khalid records billing encounters; Office Managers get Billing only when the Admin grants it.
const PROVIDER_BILLING = "edit";

const TRACKS = [
  ["Track 1 IOP", "8:30", "11:00"],
  ["Track 1 PHP", "8:30", "2:00"],
  ["Track 2 IOP", "9:30", "12:00"],
  ["AM 2 IOP", "9:30", "12:00"],
  ["AM 3 IOP", "9:30", "12:00"],
  ["Bell Adol IOP", "9:00", "11:30"],
  ["EVE 1 IOP", "5:00", "7:30"],
  ["PM IOP", "1:00", "3:30"],
];

const ENTRY_TYPES = [
  "Follow-up",
  "Follow-up & Admit Order",
  "DC Orders Only",
  "Provider Zoom",
  "Asses: PT Onsite",
];

async function main() {
  for (const p of PEOPLE) {
    const employee = await db.employee.upsert({
      where: { email: p.email },
      update: {},
      create: { name: p.name, email: p.email, title: p.title },
    });
    const user = await db.user.upsert({
      where: { email: p.email },
      update: {},
      create: { email: p.email, name: p.name, role: p.role },
    });
    for (const module of MODULES) {
      await db.moduleAccess.upsert({
        where: { userId_module: { userId: user.id, module } },
        update: {},
        create: {
          userId: user.id,
          module,
          level: module === "billing" && p.role === "PROVIDER" ? PROVIDER_BILLING : DEFAULT_LEVEL[module],
        },
      });
    }
    if (p.role === "PROVIDER") {
      // Dr Khalid is the employee; on the schedule he appears as "Dr. Khalid Ahmed".
      const existing = await db.provider.findUnique({ where: { employeeId: employee.id } });
      if (existing) {
        if (existing.name === "Dr Khalid") {
          await db.provider.update({ where: { id: existing.id }, data: { name: "Dr. Khalid Ahmed" } });
        }
      } else {
        await db.provider.upsert({
          where: { name: "Dr. Khalid Ahmed" },
          update: { employeeId: employee.id },
          create: { name: "Dr. Khalid Ahmed", employeeId: employee.id },
        });
      }
    }
  }

  // External provider (not an employee).
  await db.provider.upsert({ where: { name: "Dr. Lucy" }, update: {}, create: { name: "Dr. Lucy" } });

  for (const [i, [name, startTime, endTime]] of TRACKS.entries()) {
    await db.trackDef.upsert({
      where: { name },
      update: {},
      create: { name, startTime, endTime, sortOrder: i },
    });
  }
  for (const name of ENTRY_TYPES) {
    await db.entryType.upsert({ where: { name }, update: {}, create: { name } });
  }
  // Ledger lists (editable in the app). Admins have Ledger access automatically; others only if granted.
  for (const [i, name] of ["Deposit", "Rent", "Utilities", "Insurance", "Taxes", "Payroll", "Supplies", "Software", "Professional fees", "Other expenses"].entries()) {
    await db.ledgerCategory.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }
  for (const [i, name] of ["Cash", "Check", "Zelle", "ACH / bank transfer", "Credit card"].entries()) {
    await db.ledgerMethod.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  }
  for (const [i, p] of PEOPLE.entries()) {
    await db.ledgerParty.upsert({ where: { name: p.name }, update: {}, create: { name: p.name, sortOrder: i } });
  }
  await db.category.upsert({
    where: { name: "B & BC" },
    update: {},
    create: { name: "B & BC", sortOrder: 0 },
  });

  console.log("Seeded users, employees, tracks, entry types and categories.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
