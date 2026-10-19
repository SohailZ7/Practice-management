import type { Db as Client } from "../db";

/** The app client or a transaction client: anything that has the billingHistory model. */
type Db = Pick<Client, "billingHistory">;

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
