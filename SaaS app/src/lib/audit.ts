import { db } from "./db";
import { logError } from "./safeLog";

/** Trims and flattens free text (a file name, say) before it goes into an audit detail. */
export function clip(value: string, max = 120): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

/**
 * Audit entries record who did what to which record: ids, counts, dates, flags. Never put patient names, MRNs,
 * client info, notes or billing codes in `detail`. The table is append-only in the database (npm run db:harden).
 */
export async function audit(actorEmail: string, action: string, detail = ""): Promise<void> {
  try {
    await db.auditLog.create({ data: { actorEmail, action, detail } });
  } catch (err) {
    // Auditing must never take the app down. Log the error text only, in case it echoes values.
    logError("audit log write failed", err);
  }
}
