// Feedback: edits after a visit exists need admin approval for staff, and a provider can claim a visit but not assign another provider.
// Pure rules; the actions apply them.
export const GATED_FIELDS = ["apptTime", "program", "appointmentType"] as const;
export type GatedField = (typeof GATED_FIELDS)[number];

export const isPrivileged = (role: string) => role === "ADMIN" || role === "PROVIDER";

/** Splits a patch into what applies now and what staff must send for approval. Status and provider are handled elsewhere. */
export function splitPatch<T extends Record<string, unknown>>(role: string, patch: T): { now: Partial<T>; needsApproval: Partial<T> } {
  if (isPrivileged(role)) return { now: patch, needsApproval: {} };
  const now: Record<string, unknown> = {};
  const gated: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (GATED_FIELDS as readonly string[]).includes(k) ? (gated[k] = v) : (now[k] = v);
  }
  return { now: now as Partial<T>, needsApproval: gated as Partial<T> };
}

/**
 * Provider reassignment. Admin: anything. Provider: may set the visit to themselves (claim, even from another provider)
 * or clear their own assignment; may not assign someone else. Everyone else: no.
 */
export function providerChangeError(role: string, ownProvider: string | null, current: string, next: string): string | null {
  if (role === "ADMIN") return null;
  if (role !== "PROVIDER") return "Only a provider or admin can change the provider.";
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (next && ownProvider && same(next, ownProvider)) return null;
  if (!next && ownProvider && same(current, ownProvider)) return null;
  return ownProvider
    ? "You can claim a visit for yourself or release your own, but only an admin can assign another provider."
    : "Your login is not linked to a provider, so you cannot change the provider. Ask an admin.";
}

export const MAX_REQUEST_FIELDS = GATED_FIELDS.length;
