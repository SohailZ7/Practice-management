// Checks, against the database in DATABASE_URL, that AuditLog and BillingHistory reject UPDATE, DELETE and TRUNCATE.
// Every attempt runs inside a transaction that is rolled back, so it leaves no rows behind (they could not be removed).
//   npm run verify:audit

import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
let failures = 0;

class Rollback extends Error {}

async function expectBlocked(name: string, run: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let outcome = "NOT BLOCKED";
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "AuditLog"(id,"actorEmail",action,detail) VALUES ('zz-verify','zz@example.test','zz.verify','')`);
      await tx.$executeRawUnsafe(`INSERT INTO "BillingHistory"(id,entity,"entityId",action,snapshot,"changedById") VALUES ('zz-verify','encounter','zz','zz','{}','zz')`);
      try {
        await run(tx);
      } catch (e) {
        if (/append-only/.test(String(e))) outcome = "blocked";
        else outcome = `failed for another reason: ${String(e).slice(0, 120)}`;
      }
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) outcome = `error: ${String(e).slice(0, 120)}`;
  }
  const ok = outcome === "blocked";
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${outcome}`);
}

async function main() {
  await expectBlocked("UPDATE AuditLog", (tx) => tx.$executeRawUnsafe(`UPDATE "AuditLog" SET detail='x' WHERE id='zz-verify'`));
  await expectBlocked("DELETE AuditLog", (tx) => tx.$executeRawUnsafe(`DELETE FROM "AuditLog" WHERE id='zz-verify'`));
  await expectBlocked("TRUNCATE AuditLog", (tx) => tx.$executeRawUnsafe(`TRUNCATE "AuditLog"`));
  await expectBlocked("UPDATE BillingHistory", (tx) => tx.$executeRawUnsafe(`UPDATE "BillingHistory" SET action='x' WHERE id='zz-verify'`));
  await expectBlocked("DELETE BillingHistory", (tx) => tx.$executeRawUnsafe(`DELETE FROM "BillingHistory" WHERE id='zz-verify'`));
  await expectBlocked("TRUNCATE BillingHistory", (tx) => tx.$executeRawUnsafe(`TRUNCATE "BillingHistory"`));
  // Inserts must still work (rolled back as well).
  try {
    await db.$transaction(async (tx) => {
      await tx.auditLog.create({ data: { actorEmail: "zz@example.test", action: "zz.verify", detail: "" } });
      throw new Rollback();
    });
  } catch (e) {
    const ok = e instanceof Rollback;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  INSERT AuditLog still allowed`);
  }
  console.log(failures === 0 ? "\nAudit tables are append-only." : `\n${failures} check(s) FAILED. Run npm run db:harden.`);
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failures ? 1 : 0);
  });
