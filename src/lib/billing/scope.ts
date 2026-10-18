import type { Prisma } from "@prisma/client";
import type { Actor } from "./rules";
import { isAdmin } from "./rules";

/** Patients this user may see: all for admins; otherwise those they entered an encounter for. */
export function patientScope(user: Actor): Prisma.BillingPatientWhereInput {
  if (isAdmin(user)) return { mergedIntoId: null };
  return { mergedIntoId: null, encounters: { some: { createdById: user.id, deletedAt: null } } };
}

/** Prisma filter for "MRN or name prefix", or "Last, First". */
export function patientSearch(q: string): Prisma.BillingPatientWhereInput | null {
  const text = q.trim();
  if (!text) return null;
  const comma = text.indexOf(",");
  if (comma >= 0) {
    const last = text.slice(0, comma).trim();
    const first = text.slice(comma + 1).trim();
    return {
      lastName: { startsWith: last, mode: "insensitive" },
      firstName: { startsWith: first, mode: "insensitive" },
    };
  }
  const mrn = text.toUpperCase().replace(/\s+/g, "");
  return {
    OR: [
      { mrn: { startsWith: mrn } },
      { lastName: { startsWith: text, mode: "insensitive" } },
      { firstName: { startsWith: text, mode: "insensitive" } },
    ],
  };
}
