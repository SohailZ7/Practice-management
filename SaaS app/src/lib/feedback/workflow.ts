// Feedback-to-production workflow: statuses and who may move an item between them. Pure, so it is tested without a database.
//   owner (ADMIN)      any change; only the owner may set Build it (and must choose a scope then).
//   approver (flag)    on an item that is On staging: Approved, Needs changes, Rejected (Needs changes needs a comment).
//   agent (API token)  Build it -> Building, Needs changes -> Building, Building -> On staging (needs test notes),
//                      Approved -> Shipped.
// ui_small items may auto-promote after approval; "other" items also need the owner's own approval click.

export const STATUSES = ["new", "triaged", "build_it", "building", "on_staging", "approved", "needs_changes", "rejected", "shipped"] as const;
export type FeedbackStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  triaged: "Triaged",
  build_it: "Build it",
  building: "Building",
  on_staging: "On staging (ready to test)",
  approved: "Approved",
  needs_changes: "Needs changes",
  rejected: "Rejected",
  shipped: "Shipped",
};
export const SCOPES = ["ui_small", "other"] as const;
export type FeedbackScope = (typeof SCOPES)[number];
export const SCOPE_LABEL: Record<FeedbackScope, string> = { ui_small: "Small UI change", other: "Other (needs owner approval)" };

export const isStatus = (v: unknown): v is FeedbackStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);
export const isScope = (v: unknown): v is FeedbackScope => typeof v === "string" && (SCOPES as readonly string[]).includes(v);

export type Actor = { kind: "user" | "agent"; isAdmin: boolean; isApprover: boolean };

const APPROVER_TARGETS: FeedbackStatus[] = ["approved", "needs_changes", "rejected"];
const AGENT_MOVES: Record<string, FeedbackStatus[]> = {
  build_it: ["building"],
  needs_changes: ["building"],
  building: ["on_staging"],
  approved: ["shipped"],
};

export type Move = { ok: true } | { ok: false; error: string };

export function checkMove(
  actor: Actor,
  item: { status: FeedbackStatus; scope: FeedbackScope | null; testNotes: string },
  to: FeedbackStatus,
  extra: { scope?: FeedbackScope | null; comment?: string; testNotes?: string },
): Move {
  if (item.status === to) return { ok: false, error: "already_in_status" };
  if (actor.kind === "agent") {
    if (!(AGENT_MOVES[item.status] ?? []).includes(to)) return { ok: false, error: "agent_move_not_allowed" };
    if (to === "on_staging" && !(extra.testNotes ?? item.testNotes).trim()) return { ok: false, error: "test_notes_required" };
    return { ok: true };
  }
  if (to === "build_it") {
    if (!actor.isAdmin) return { ok: false, error: "only_owner_can_build_it" };
    if (!isScope(extra.scope ?? item.scope)) return { ok: false, error: "scope_required" };
    return { ok: true };
  }
  if (actor.isAdmin) {
    if (to === "needs_changes" && !extra.comment?.trim()) return { ok: false, error: "comment_required" };
    return { ok: true };
  }
  if (actor.isApprover && item.status === "on_staging" && APPROVER_TARGETS.includes(to)) {
    if (to === "needs_changes" && !extra.comment?.trim()) return { ok: false, error: "comment_required" };
    return { ok: true };
  }
  return { ok: false, error: "not_allowed" };
}

/** What the owner and approvers can do next from here (drives the buttons). */
export function nextMoves(actor: Actor, status: FeedbackStatus): FeedbackStatus[] {
  if (actor.kind === "agent") return AGENT_MOVES[status] ?? [];
  if (actor.isAdmin) return STATUSES.filter((s) => s !== status);
  if (actor.isApprover && status === "on_staging") return APPROVER_TARGETS;
  return [];
}

/** Auto-promotion is allowed only after approval of a small UI change. "Other" also needs the owner's approval. */
export function readyToPromote(item: { status: FeedbackStatus; scope: FeedbackScope | null; ownerApproved: boolean }): { ready: boolean; needsOwner: boolean } {
  if (item.status !== "approved") return { ready: false, needsOwner: false };
  if (item.scope === "ui_small") return { ready: true, needsOwner: false };
  return { ready: item.ownerApproved, needsOwner: !item.ownerApproved };
}

export const MAX_COMMENT = 2000;
export const MAX_TEST_NOTES = 4000;
