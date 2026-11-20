// Ledger expense approval (Sohail, 2026-11-19): every expense (cash out) starts Pending; one final approver approves or rejects it;
// approved entries lock. Anyone with Ledger edit may enter; only a user flagged ledgerApprover may approve. Pure so it is easy to test.
export const APPROVAL_STATES = ["pending", "approved", "rejected"] as const;
export type Approval = (typeof APPROVAL_STATES)[number];
export const approvalOf = (v: unknown): Approval => ((APPROVAL_STATES as readonly string[]).includes(v as string) ? (v as Approval) : "approved");

/** Status for a new or edited entry: expenses wait for approval, income does not. */
export const statusForSave = (cashOut: number, previous?: Approval): Approval => (cashOut > 0 ? "pending" : previous ?? "approved");
export const isLocked = (s: Approval) => s === "approved";
export const LOCKED_MESSAGE = "This entry is approved and locked. Ask the approver to reject it first if it must change.";
export const canApprove = (u: { ledgerApprover?: boolean }) => u.ledgerApprover === true;
