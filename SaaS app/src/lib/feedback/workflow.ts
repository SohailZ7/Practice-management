// Feedback-to-production workflow: statuses and who may move an item between them. Pure, so it is tested without a database.
//   Main flow:  New -> Triaged -> Building -> On Staging -> Tested -> Release to Prod   (Rejected ends an item).
//   Triage has an outcome: Accepted (moves toward Building), Rejected (ends the item), More info needed (comment required;
//   the item waits as Triaged until the author or owner replies and the owner triages again).
//   owner (ADMIN)     any change; only the owner triages (Accepted needs a scope) and sets Tested for "other" items.
//   approver (flag)   on an item that is On Staging: Tested, back to Building (comment required), Rejected.
//   agent (API token) New -> Triaged (counts as Accepted, no scope), Triaged+Accepted -> Building, Building -> On Staging (needs test
//                     notes), On Staging -> Tested, Tested -> Release to Prod. Never: Rejected, More info, owner approval, deletes.
// Small UI changes auto-promote once Tested; "other" items also need the owner's own approval click.
//
// Older rows keep their old words in the database until migrated; normalizeState() reads them as the new states:
//   build_it -> Triaged + Accepted, approved -> Tested, shipped -> Release to Prod, needs_changes -> Building.

export const STATUSES = ["new", "triaged", "building", "on_staging", "tested", "released", "rejected"] as const;
export type FeedbackStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  triaged: "Triaged",
  building: "Building",
  on_staging: "On Staging",
  tested: "Tested",
  released: "Release to Prod",
  rejected: "Rejected",
};
/** The main flow, in order (Rejected is a side exit, shown only when it applies). */
export const FLOW: readonly FeedbackStatus[] = ["new", "triaged", "building", "on_staging", "tested", "released"];

export const TRIAGE_OUTCOMES = ["accepted", "rejected", "more_info"] as const;
export type TriageOutcome = (typeof TRIAGE_OUTCOMES)[number];
export const TRIAGE_LABEL: Record<TriageOutcome, string> = { accepted: "Accepted", rejected: "Rejected", more_info: "More info needed" };
export const isTriage = (v: unknown): v is TriageOutcome => typeof v === "string" && (TRIAGE_OUTCOMES as readonly string[]).includes(v);
/** The status a triage outcome puts the item in. */
export const triageStatus = (t: TriageOutcome): FeedbackStatus => (t === "rejected" ? "rejected" : "triaged");

/** Words older rows may still hold, and what they mean now. */
export const LEGACY_STATUSES = ["build_it", "approved", "needs_changes", "shipped"] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];
export const LEGACY_MAP: Record<LegacyStatus, { status: FeedbackStatus; triage: TriageOutcome | null }> = {
  build_it: { status: "triaged", triage: "accepted" },
  approved: { status: "tested", triage: null },
  needs_changes: { status: "building", triage: null },
  shipped: { status: "released", triage: null },
};
const isLegacy = (v: unknown): v is LegacyStatus => typeof v === "string" && (LEGACY_STATUSES as readonly string[]).includes(v);

export const SCOPES = ["ui_small", "other"] as const;
export type FeedbackScope = (typeof SCOPES)[number];
export const SCOPE_LABEL: Record<FeedbackScope, string> = { ui_small: "Small UI change", other: "Other (needs owner approval)" };

export const isStatus = (v: unknown): v is FeedbackStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);
export const isScope = (v: unknown): v is FeedbackScope => typeof v === "string" && (SCOPES as readonly string[]).includes(v);
/** A status word a client may send or filter by: a current one, or a legacy one (read as its new meaning). */
export const isStatusWord = (v: unknown): v is FeedbackStatus | LegacyStatus => isStatus(v) || isLegacy(v);

/** Reads a stored row as the new states. Unknown or missing words read as New. Pure; also the migration mapping. */
export function normalizeState(row: { status?: string | null; triageOutcome?: string | null }): { status: FeedbackStatus; triage: TriageOutcome | null } {
  const stored = isTriage(row.triageOutcome) ? row.triageOutcome : null;
  if (isLegacy(row.status)) {
    const m = LEGACY_MAP[row.status];
    return { status: m.status, triage: stored ?? m.triage };
  }
  if (isStatus(row.status)) return { status: row.status, triage: stored };
  return { status: "new", triage: stored };
}

/** Every stored word that reads as this status (for filtering a database that still holds old rows). */
export function storedWordsFor(status: FeedbackStatus): string[] {
  return [status, ...LEGACY_STATUSES.filter((l) => LEGACY_MAP[l].status === status)];
}

export type Actor = { kind: "user" | "agent"; isAdmin: boolean; isApprover: boolean };

const APPROVER_TARGETS: FeedbackStatus[] = ["tested", "building", "rejected"];

export type Move = { ok: true } | { ok: false; error: string };
export type Item = { status: FeedbackStatus; scope: FeedbackScope | null; testNotes: string; triage?: TriageOutcome | null };
export type MoveExtra = { scope?: FeedbackScope | null; comment?: string; testNotes?: string; triage?: TriageOutcome };

/** Agent path. Building from Triaged needs the Accepted outcome (checked in checkMove). */
function agentMoves(status: FeedbackStatus): FeedbackStatus[] {
  return status === "new" ? ["triaged"] : status === "triaged" ? ["building"] : status === "building" ? ["on_staging"] : status === "on_staging" ? ["tested"] : status === "tested" ? ["released"] : [];
}

export function checkMove(actor: Actor, item: Item, to: FeedbackStatus, extra: MoveExtra): Move {
  const retriage = to === "triaged" && item.status === "triaged" && !!extra.triage && extra.triage !== (item.triage ?? null);
  if (item.status === to && !retriage) return { ok: false, error: "already_in_status" };
  if (actor.kind === "agent") {
    if (!agentMoves(item.status).includes(to)) return { ok: false, error: "agent_move_not_allowed" };
    if (item.status === "triaged" && item.triage !== "accepted") return { ok: false, error: "agent_move_not_allowed" };
    if (to === "on_staging" && !(extra.testNotes ?? item.testNotes).trim()) return { ok: false, error: "test_notes_required" };
    return { ok: true };
  }
  const needsComment = (item.status === "on_staging" || item.status === "tested") && to === "building";
  if (actor.isAdmin) {
    if (to === "triaged") {
      if (!extra.triage || extra.triage === "rejected") return { ok: false, error: "triage_required" };
      if (extra.triage === "accepted" && !isScope(extra.scope ?? item.scope)) return { ok: false, error: "scope_required" };
      if (extra.triage === "more_info" && !extra.comment?.trim()) return { ok: false, error: "comment_required" };
      return { ok: true };
    }
    if (to === "building" && !isScope(extra.scope ?? item.scope)) return { ok: false, error: "scope_required" };
    if (needsComment && !extra.comment?.trim()) return { ok: false, error: "comment_required" };
    return { ok: true };
  }
  if (to === "triaged") return { ok: false, error: "only_owner_can_triage" };
  if (actor.isApprover && item.status === "on_staging" && APPROVER_TARGETS.includes(to)) {
    if (needsComment && !extra.comment?.trim()) return { ok: false, error: "comment_required" };
    return { ok: true };
  }
  return { ok: false, error: "not_allowed" };
}

/** What the owner and approvers can do next from here (drives the buttons). */
export function nextMoves(actor: Actor, status: FeedbackStatus, triage: TriageOutcome | null = null): FeedbackStatus[] {
  if (actor.kind === "agent") return status === "triaged" && triage !== "accepted" ? [] : agentMoves(status);
  if (actor.isAdmin) return STATUSES.filter((s) => s !== status);
  if (actor.isApprover && status === "on_staging") return APPROVER_TARGETS;
  return [];
}

/** Auto-promotion is allowed only after Tested on a small UI change. "Other" also needs the owner's approval. */
export function readyToPromote(item: { status: FeedbackStatus; scope: FeedbackScope | null; ownerApproved: boolean }): { ready: boolean; needsOwner: boolean } {
  if (item.status !== "tested") return { ready: false, needsOwner: false };
  if (item.scope === "ui_small") return { ready: true, needsOwner: false };
  return { ready: item.ownerApproved, needsOwner: !item.ownerApproved };
}

export const MAX_COMMENT = 2000;
export const MAX_TEST_NOTES = 4000;
