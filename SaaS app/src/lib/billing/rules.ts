// Who can change what in Billing. Pure functions so they are easy to test.
//
// - A provider can see the whole record of a patient they entered an encounter for.
// - Seeing is not editing: only the person who entered an encounter, or an admin, can change
//   or delete it.
// - Nobody can edit or delete an encounter while it is marked "Entered into GetIX"; an admin
//   removes the mark first.

export type Actor = { id: string; role: string };
export type EncounterState = { createdById: string; getixEntered: boolean; deletedAt: Date | null };

export const isAdmin = (user: Actor) => user.role === "ADMIN";
export const ownsEncounter = (user: Actor, e: Pick<EncounterState, "createdById">) => e.createdById === user.id;

/** Built on ownership, deliberately not on visibility, so seeing a colleague's encounter never grants edit rights. */
export const canChangeEncounter = (user: Actor, e: EncounterState) =>
  (isAdmin(user) || ownsEncounter(user, e)) && !e.getixEntered && !e.deletedAt;

export function getixBlocker(patient: { mrn: string | null }, e: Pick<EncounterState, "deletedAt" | "getixEntered">): string | null {
  if (e.deletedAt) return "A deleted encounter can't be marked.";
  if (!patient.mrn) return "Add the patient's MRN before marking this encounter as entered into GetIX.";
  return null;
}
