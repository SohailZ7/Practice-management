import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PEOPLE = [
  { name: "Sohail", email: "sohail30@gmail.com", role: "ADMIN", title: "Administrator" },
  { name: "Dr Khalid", email: "khalid21631@gmail.com", role: "PROVIDER", title: "Doctor" },
  { name: "Razak Ahmed", email: "razakahmed19@gmail.com", role: "STAFF", title: "Office Manager" },
  { name: "Muntaha", email: "muntahastar@gmail.com", role: "STAFF", title: "Office Manager" },
];

const MODULES = ["schedule", "tasks", "employees"];

// Non-admins start with edit on schedule and tasks, view on employees. Admin changes this in the app.
const DEFAULT_LEVEL: Record<string, string> = { schedule: "edit", tasks: "edit", employees: "view" };

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
        create: { userId: user.id, module, level: DEFAULT_LEVEL[module] },
      });
    }
    if (p.role === "PROVIDER") {
      await db.provider.upsert({
        where: { name: p.name },
        update: {},
        create: { name: p.name, employeeId: employee.id },
      });
    }
  }

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
