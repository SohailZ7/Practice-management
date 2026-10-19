import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Saves the previous version of a record before it changes. Append-only through the app. */
export async function recordHistory(
  db: Db,
  entity: "encounter" | "patient",
  entityId: string,
  action: string,
  snapshot: unknown,
  changedById: string,
) {
  await db.billingHistory.create({
    data: { entity, entityId, action, snapshot: JSON.parse(JSON.stringify(snapshot)), changedById },
  });
}
