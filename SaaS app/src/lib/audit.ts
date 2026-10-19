import { db } from "./db";

export async function audit(actorEmail: string, action: string, detail = ""): Promise<void> {
  try {
    await db.auditLog.create({ data: { actorEmail, action, detail } });
  } catch (err) {
    // Auditing must never take the app down.
    console.error("audit log write failed", err);
  }
}
