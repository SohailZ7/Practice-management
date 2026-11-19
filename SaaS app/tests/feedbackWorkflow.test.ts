import { describe, expect, it } from "vitest";
import { checkMove, FLOW, nextMoves, normalizeState, readyToPromote, STATUS_LABEL, STATUSES, storedWordsFor, TRIAGE_LABEL, TRIAGE_OUTCOMES, type Actor } from "../src/lib/feedback/workflow";
import { feedbackShape, agentActor } from "../src/lib/mcpApi/feedbackApi";
import { SCOPES as TOKEN_SCOPES } from "../src/lib/mcpApi/tokens";
import { toFeedbackOut } from "../src/lib/feedback/rules";

const owner: Actor = { kind: "user", isAdmin: true, isApprover: true };
const approver: Actor = { kind: "user", isAdmin: false, isApprover: true };
const staff: Actor = { kind: "user", isAdmin: false, isApprover: false };
const agent: Actor = { kind: "agent", isAdmin: false, isApprover: false };
const item = (status: (typeof STATUSES)[number], over: { scope?: "ui_small" | "other"; triage?: "accepted" | "rejected" | "more_info" } = {}) => ({ status, scope: null as null | "ui_small" | "other", testNotes: "", ...over });

describe("feedback workflow permissions", () => {
  it("only the owner triages; Accepted needs a scope, More info needed needs a comment, Rejected ends it", () => {
    expect(checkMove(owner, item("new"), "triaged", {})).toEqual({ ok: false, error: "triage_required" });
    expect(checkMove(owner, item("new"), "triaged", { triage: "accepted" })).toEqual({ ok: false, error: "scope_required" });
    expect(checkMove(owner, item("new"), "triaged", { triage: "accepted", scope: "ui_small" })).toEqual({ ok: true });
    expect(checkMove(owner, item("new"), "triaged", { triage: "more_info" })).toEqual({ ok: false, error: "comment_required" });
    expect(checkMove(owner, item("new"), "triaged", { triage: "more_info", comment: "Which screen?" })).toEqual({ ok: true });
    expect(checkMove(owner, item("new"), "rejected", {})).toEqual({ ok: true });
    for (const a of [approver, staff, agent]) expect(checkMove(a, item("new"), "triaged", { triage: "accepted", scope: "ui_small" }).ok).toBe(false);
    expect(checkMove(approver, item("new"), "triaged", { triage: "accepted", scope: "ui_small" })).toEqual({ ok: false, error: "only_owner_can_triage" });
  });
  it("re-triaging from More info needed to Accepted is allowed even though the status stays Triaged", () => {
    const t = item("triaged", { triage: "more_info" });
    expect(checkMove(owner, t, "triaged", { triage: "accepted", scope: "other" })).toEqual({ ok: true });
    expect(checkMove(owner, t, "triaged", { triage: "more_info", comment: "x" })).toEqual({ ok: false, error: "already_in_status" });
  });
  it("Building needs a scope, and going back to Building from staging or Tested needs a comment", () => {
    expect(checkMove(owner, item("triaged"), "building", {})).toEqual({ ok: false, error: "scope_required" });
    expect(checkMove(owner, item("triaged", { scope: "other" }), "building", {})).toEqual({ ok: true });
    expect(checkMove(owner, item("tested", { scope: "other" }), "building", {})).toEqual({ ok: false, error: "comment_required" });
    expect(checkMove(owner, item("tested", { scope: "other" }), "building", { comment: "Still broken" })).toEqual({ ok: true });
  });
  it("approvers act only on On Staging items: Tested, back to Building (comment), Rejected", () => {
    expect(checkMove(approver, item("on_staging"), "tested", {})).toEqual({ ok: true });
    expect(checkMove(approver, item("on_staging"), "rejected", {})).toEqual({ ok: true });
    expect(checkMove(approver, item("on_staging"), "building", {})).toEqual({ ok: false, error: "comment_required" });
    expect(checkMove(approver, item("on_staging"), "building", { comment: "Button too small" })).toEqual({ ok: true });
    expect(checkMove(approver, item("new"), "tested", {}).ok).toBe(false);
    expect(checkMove(approver, item("on_staging"), "released", {}).ok).toBe(false);
    expect(checkMove(staff, item("on_staging"), "tested", {}).ok).toBe(false);
  });
  it("the agent follows only its own path", () => {
    expect(checkMove(agent, item("triaged", { triage: "accepted" }), "building", {}).ok).toBe(true);
    expect(checkMove(agent, item("triaged", { triage: "more_info" }), "building", {}).ok).toBe(false);
    expect(checkMove(agent, item("triaged"), "building", {}).ok).toBe(false);
    expect(checkMove(agent, item("building"), "on_staging", {})).toEqual({ ok: false, error: "test_notes_required" });
    expect(checkMove(agent, item("building"), "on_staging", { testNotes: "Open Schedule; check the row." })).toEqual({ ok: true });
    expect(checkMove(agent, item("tested"), "released", {}).ok).toBe(true);
    for (const to of ["tested", "triaged", "rejected", "building"] as const) expect(checkMove(agent, item("on_staging"), to, {}).ok).toBe(false);
    expect(checkMove(agent, item("new"), "building", {}).ok).toBe(false);
    expect(checkMove(agent, item("on_staging"), "released", {}).ok).toBe(false);
  });
  it("no change to the same status", () => expect(checkMove(owner, item("new"), "new", {})).toEqual({ ok: false, error: "already_in_status" }));
  it("buttons: owner sees every other status, approver three, staff none, agent its one step", () => {
    expect(nextMoves(owner, "new")).toHaveLength(STATUSES.length - 1);
    expect(nextMoves(approver, "on_staging")).toEqual(["tested", "building", "rejected"]);
    expect(nextMoves(approver, "building")).toEqual([]);
    expect(nextMoves(staff, "on_staging")).toEqual([]);
    expect(nextMoves(agent, "tested")).toEqual(["released"]);
    expect(nextMoves(agent, "triaged", "more_info")).toEqual([]);
    expect(nextMoves(agent, "triaged", "accepted")).toEqual(["building"]);
  });
  it("only small UI changes auto-promote once Tested; other needs the owner's approval too", () => {
    expect(readyToPromote({ status: "tested", scope: "ui_small", ownerApproved: false })).toEqual({ ready: true, needsOwner: false });
    expect(readyToPromote({ status: "tested", scope: "other", ownerApproved: false })).toEqual({ ready: false, needsOwner: true });
    expect(readyToPromote({ status: "tested", scope: "other", ownerApproved: true }).ready).toBe(true);
    expect(readyToPromote({ status: "on_staging", scope: "ui_small", ownerApproved: false }).ready).toBe(false);
  });
});

describe("migration mapping (old words read as the new states)", () => {
  it("maps every old status and keeps new ones", () => {
    expect(normalizeState({ status: "build_it" })).toEqual({ status: "triaged", triage: "accepted" });
    expect(normalizeState({ status: "approved" })).toEqual({ status: "tested", triage: null });
    expect(normalizeState({ status: "shipped" })).toEqual({ status: "released", triage: null });
    expect(normalizeState({ status: "needs_changes" })).toEqual({ status: "building", triage: null });
    expect(normalizeState({ status: "rejected" })).toEqual({ status: "rejected", triage: null });
    expect(normalizeState({ status: "triaged", triageOutcome: "more_info" })).toEqual({ status: "triaged", triage: "more_info" });
    expect(normalizeState({ status: "on_staging" })).toEqual({ status: "on_staging", triage: null });
    expect(normalizeState({ status: "bogus" })).toEqual({ status: "new", triage: null });
    expect(normalizeState({})).toEqual({ status: "new", triage: null });
  });
  it("is idempotent: reading a migrated row changes nothing", () => {
    for (const w of ["build_it", "approved", "shipped", "needs_changes", ...STATUSES]) {
      const once = normalizeState({ status: w });
      expect(normalizeState({ status: once.status, triageOutcome: once.triage })).toEqual(once);
    }
  });
  it("filters search the new word and the old words that read as it", () => {
    expect(storedWordsFor("tested")).toEqual(["tested", "approved"]);
    expect(storedWordsFor("released")).toEqual(["released", "shipped"]);
    expect(storedWordsFor("building")).toEqual(["building", "needs_changes"]);
    expect(storedWordsFor("triaged")).toEqual(["triaged", "build_it"]);
    expect(storedWordsFor("new")).toEqual(["new"]);
  });
  it("labels match the spec", () => {
    expect(FLOW.map((s) => STATUS_LABEL[s])).toEqual(["New", "Triaged", "Building", "On Staging", "Tested", "Release to Prod"]);
    expect(TRIAGE_OUTCOMES.map((t) => TRIAGE_LABEL[t])).toEqual(["Accepted", "Rejected", "More info needed"]);
  });
});

describe("feedback API shape", () => {
  const row = { id: "1", kind: "BUG", title: "t", description: "d", authorId: "u", createdAt: new Date(), updatedAt: new Date(), author: { name: "Someone" }, status: "triaged", triageOutcome: "accepted", scope: "ui_small", testNotes: "n" };
  it("never exposes author or email", () => {
    const s = feedbackShape(toFeedbackOut(row, ""));
    expect(Object.keys(s)).not.toContain("authorName");
    expect(JSON.stringify(s)).not.toContain("Someone");
    expect(s.status).toBe("triaged");
    expect(s.triage).toBe("accepted");
  });
  it("the agent is never an admin or approver, whoever owns the token", () => {
    expect(agentActor({ email: "a@b.c", name: "Sohail" })).toMatchObject({ kind: "agent", isAdmin: false, isApprover: false, name: "Agent" });
  });
  it("feedback is a token scope", () => expect(TOKEN_SCOPES).toContain("feedback"));
  it("old status words read as the new states in the API shape", () => {
    expect(feedbackShape(toFeedbackOut({ ...row, status: "build_it", triageOutcome: null }, ""))).toMatchObject({ status: "triaged", triage: "accepted" });
    expect(feedbackShape(toFeedbackOut({ ...row, status: "shipped" }, "")).status).toBe("released");
  });
  it("old rows without workflow fields read as new", () => {
    const { status, triageOutcome, scope, testNotes, ...old } = row;
    expect(toFeedbackOut(old, "").status).toBe("new");
  });
});
