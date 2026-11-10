import { describe, expect, it } from "vitest";
import { checkMove, nextMoves, readyToPromote, STATUSES, type Actor } from "../src/lib/feedback/workflow";
import { feedbackShape, agentActor } from "../src/lib/mcpApi/feedbackApi";
import { SCOPES as TOKEN_SCOPES } from "../src/lib/mcpApi/tokens";
import { toFeedbackOut } from "../src/lib/feedback/rules";

const owner: Actor = { kind: "user", isAdmin: true, isApprover: true };
const approver: Actor = { kind: "user", isAdmin: false, isApprover: true };
const staff: Actor = { kind: "user", isAdmin: false, isApprover: false };
const agent: Actor = { kind: "agent", isAdmin: false, isApprover: false };
const item = (status: (typeof STATUSES)[number], over = {}) => ({ status, scope: null as null | "ui_small" | "other", testNotes: "", ...over });

describe("feedback workflow permissions", () => {
  it("only the owner can set Build it, and needs a scope", () => {
    expect(checkMove(owner, item("triaged"), "build_it", {})).toEqual({ ok: false, error: "scope_required" });
    expect(checkMove(owner, item("triaged"), "build_it", { scope: "ui_small" })).toEqual({ ok: true });
    for (const a of [approver, staff, agent]) expect(checkMove(a, item("triaged"), "build_it", { scope: "ui_small" }).ok).toBe(false);
  });
  it("approvers act only on On staging items, and Needs changes needs a comment", () => {
    expect(checkMove(approver, item("on_staging"), "approved", {})).toEqual({ ok: true });
    expect(checkMove(approver, item("on_staging"), "rejected", {})).toEqual({ ok: true });
    expect(checkMove(approver, item("on_staging"), "needs_changes", {})).toEqual({ ok: false, error: "comment_required" });
    expect(checkMove(approver, item("on_staging"), "needs_changes", { comment: "Button too small" })).toEqual({ ok: true });
    expect(checkMove(approver, item("new"), "approved", {}).ok).toBe(false);
    expect(checkMove(approver, item("on_staging"), "triaged", {}).ok).toBe(false);
    expect(checkMove(staff, item("on_staging"), "approved", {}).ok).toBe(false);
  });
  it("the agent follows only its own path", () => {
    expect(checkMove(agent, item("build_it"), "building", {}).ok).toBe(true);
    expect(checkMove(agent, item("needs_changes"), "building", {}).ok).toBe(true);
    expect(checkMove(agent, item("building"), "on_staging", {})).toEqual({ ok: false, error: "test_notes_required" });
    expect(checkMove(agent, item("building"), "on_staging", { testNotes: "Open Schedule; check the row." })).toEqual({ ok: true });
    expect(checkMove(agent, item("approved"), "shipped", {}).ok).toBe(true);
    for (const to of ["approved", "build_it", "triaged", "rejected", "needs_changes"] as const) expect(checkMove(agent, item("on_staging"), to, {}).ok).toBe(false);
    expect(checkMove(agent, item("new"), "building", {}).ok).toBe(false);
  });
  it("no change to the same status", () => expect(checkMove(owner, item("new"), "new", {})).toEqual({ ok: false, error: "already_in_status" }));
  it("buttons: owner sees every other status, approver three, staff none", () => {
    expect(nextMoves(owner, "new")).toHaveLength(STATUSES.length - 1);
    expect(nextMoves(approver, "on_staging")).toEqual(["approved", "needs_changes", "rejected"]);
    expect(nextMoves(approver, "building")).toEqual([]);
    expect(nextMoves(staff, "on_staging")).toEqual([]);
  });
  it("only small UI changes auto-promote; other needs the owner's approval too", () => {
    expect(readyToPromote({ status: "approved", scope: "ui_small", ownerApproved: false })).toEqual({ ready: true, needsOwner: false });
    expect(readyToPromote({ status: "approved", scope: "other", ownerApproved: false })).toEqual({ ready: false, needsOwner: true });
    expect(readyToPromote({ status: "approved", scope: "other", ownerApproved: true }).ready).toBe(true);
    expect(readyToPromote({ status: "on_staging", scope: "ui_small", ownerApproved: false }).ready).toBe(false);
  });
});

describe("feedback API shape", () => {
  const row = { id: "1", kind: "BUG", title: "t", description: "d", authorId: "u", createdAt: new Date(), updatedAt: new Date(), author: { name: "Someone" }, status: "build_it", scope: "ui_small", testNotes: "n" };
  it("never exposes author or email", () => {
    const s = feedbackShape(toFeedbackOut(row, ""));
    expect(Object.keys(s)).not.toContain("authorName");
    expect(JSON.stringify(s)).not.toContain("Someone");
    expect(s.status).toBe("build_it");
  });
  it("the agent is never an admin or approver, whoever owns the token", () => {
    expect(agentActor({ email: "a@b.c", name: "Sohail" })).toMatchObject({ kind: "agent", isAdmin: false, isApprover: false, name: "Agent" });
  });
  it("feedback is a token scope", () => expect(TOKEN_SCOPES).toContain("feedback"));
  it("old rows without workflow fields read as new", () => {
    const { status, scope, testNotes, ...old } = row;
    expect(toFeedbackOut(old, "").status).toBe("new");
  });
});
