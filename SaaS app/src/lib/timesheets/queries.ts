import { db } from "../db";
import { DEFAULT_RATE_CENTS, EMPLOYEE_NAMES } from "./calc";

/** Pre-creates Muntaha, Janita and Zaid. Idempotent; never changes an existing employee's rate. */
export async function ensureEmployees() {
  const existing = await db.timesheetEmployee.findMany({ select: { name: true } });
  const have = new Set(existing.map((e) => e.name));
  for (const [i, name] of EMPLOYEE_NAMES.entries()) {
    if (!have.has(name)) {
      await db.timesheetEmployee.create({ data: { name, sortOrder: i, defaultRateCents: DEFAULT_RATE_CENTS } }).catch(() => undefined);
    }
  }
  return db.timesheetEmployee.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}
