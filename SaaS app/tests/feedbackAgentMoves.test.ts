import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; kind: string; title: string; description: string; authorId: string; createdAt: Date; updatedAt: Date; author: { name: string }; status: string; triageOutcome: string | null; scope: string | null; testNotes: string; ownerApprovedAt: Date | null; shippedRelease: number | null };
let row: Row;
const events: { field: string; fromValue: string | null; toValue: string | null; actorKind: string }[] = [];
const audits: string[] = [];
vi.mock("../src/lib/db", () => {
  const tx = {
    feedbackItem: { update: async ({ data }: { data: Partial<Row> }) => { row = { ...row, ...data }; return row; } },
    feedbackEvent: { create: async ({ data }: { data: (typeof events)[number] }) => void events.push(data) },
    feedbackComment: { create: async () => ({}) },
  };
  return { db: { feedbackItem: { findUnique: async () => row }, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("../src/lib/audit", () => ({ audit: async (_a: string, _b: string, d: string) => void audits.push(d) }));

import { setFeedbackWorkflow } from "../src/lib/feedback/service";
import { agentActor } from "../src/lib/mcpApi/feedbackApi";

const agent = agentActor({ email: "a@b.c", name: "x" });
const mk = (status: string, extra: Partial<Row> = {}): Row => ({ id: "f1", kind: "FEEDBACK", title: "Fake item", description: "", authorId: "u1", createdAt: new Date(), updatedAt: new Date(), author: { name: "Someone" }, status, triageOutcome: null, scope: null, testNotes: "", ownerApprovedAt: null, shippedRelease: null, ...extra });
beforeEach(() => { events.length = 0; audits.length = 0; });

describe("agent token moves (service)", () => {
  it("runs the whole path New -> Triaged (Accepted) -> Building -> On Staging -> Tested -> Released", async () => {
    row = mk("new");
    expect((await setFeedbackWorkflow(agent, "f1", { status: "triaged" })).status).toBe("triaged");
    expect(row.triageOutcome).toBe("accepted");
    await setFeedbackWorkflow(agent, "f1", { status: "building" });
    await setFeedbackWorkflow(agent, "f1", { status: "on_staging", testNotes: "Open the page and check it." });
    await setFeedbackWorkflow(agent, "f1", { status: "tested" });
    expect(row.ownerApprovedAt).toBeNull();
    await setFeedbackWorkflow(agent, "f1", { status: "released" });
    expect(row.status).toBe("released");
    expect(events.every((e) => e.actorKind === "agent")).toBe(true);
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((d) => d.endsWith("via agent") && !d.includes("Fake item"))).toBe(true);
  });
  it("still cannot reject, ask for more info, approve as owner, or skip steps", async () => {
    row = mk("new");
    await expect(setFeedbackWorkflow(agent, "f1", { status: "rejected" })).rejects.toMatchObject({ status: 403 });
    await expect(setFeedbackWorkflow(agent, "f1", { triage: "rejected" })).rejects.toMatchObject({ status: 403 });
    await expect(setFeedbackWorkflow(agent, "f1", { triage: "more_info", comment: "?" })).rejects.toMatchObject({ status: 403 });
    await expect(setFeedbackWorkflow(agent, "f1", { status: "building" })).rejects.toMatchObject({ status: 403 });
    row = mk("on_staging");
    await expect(setFeedbackWorkflow(agent, "f1", { status: "released" })).rejects.toMatchObject({ status: 403 });
    row = mk("triaged", { triageOutcome: "more_info" });
    await expect(setFeedbackWorkflow(agent, "f1", { status: "building" })).rejects.toMatchObject({ status: 403 });
  });
});
