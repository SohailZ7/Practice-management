// Documentation check flow (feedback cmwldtxy9): draft > submitted > verified > entered in GetIX.
// A provider or admin marks submitted; the admin reviews date and diagnosis and verifies; then the admin marks it entered.
// NB DC (billable to FFX, not GetIX) stops at verified. Pure rules.
export type StageFields = { submittedAt: Date | null; verifiedAt: Date | null; getixEntered: boolean; deletedAt: Date | null; chargeCode?: string };
export type Stage = "draft" | "submitted" | "verified" | "entered";

export function stageOf(e: Pick<StageFields, "submittedAt" | "verifiedAt" | "getixEntered">): Stage {
  if (e.getixEntered) return "entered";
  if (e.verifiedAt) return "verified";
  if (e.submittedAt) return "submitted";
  return "draft";
}
export const STAGE_LABEL: Record<Stage, string> = { draft: "Draft", submitted: "Submitted", verified: "Verified", entered: "In GetIX" };

/** Error text, or null when the actor may mark this encounter submitted (or take the mark back). */
export function submitBlocker(role: string, isOwner: boolean, e: StageFields): string | null {
  if (e.deletedAt) return "A deleted encounter can't be submitted.";
  if (e.getixEntered) return "Already entered in GetIX.";
  if (e.verifiedAt) return "Already verified. An admin removes the verification first.";
  if (!(role === "ADMIN" || role === "PROVIDER" || isOwner)) return "Only a provider, the person who entered it, or an admin can submit.";
  return null;
}

export function verifyBlocker(role: string, e: StageFields & { icd10Codes: string[] }): string | null {
  if (role !== "ADMIN") return "Only an admin can verify.";
  if (e.deletedAt) return "A deleted encounter can't be verified.";
  if (e.getixEntered) return "Already entered in GetIX.";
  if (!e.chargeCode?.trim()) return "Set the charge code before verifying.";
  if (e.icd10Codes.length === 0 && e.chargeCode.trim().toUpperCase() !== "NB DC") return "Add a diagnosis before verifying.";
  return null;
}

/** GetIX entry needs a verified encounter. */
export function getixNeedsVerify(e: Pick<StageFields, "verifiedAt">): string | null {
  return e.verifiedAt ? null : "An admin must verify this encounter before it is entered into GetIX.";
}

/** Incorrect Billing bucket: flagged encounters wait for the action (delete in GetIX / remove) until marked complete. */
export type IncorrectState = "none" | "open" | "complete";
export function incorrectState(e: { incorrectAt: Date | null; incorrectResolvedAt: Date | null }): IncorrectState {
  if (!e.incorrectAt) return "none";
  return e.incorrectResolvedAt ? "complete" : "open";
}
