import { describe, expect, it, vi } from "vitest";

const created: Record<string, unknown>[] = [];
const events: Record<string, unknown>[] = [];
vi.mock("../src/lib/db", () => {
  const tx = {
    feedbackItem: { create: async ({ data }: { data: Record<string, unknown> }) => { const r = { id: "f1", createdAt: new Date(), updatedAt: new Date(), author: { name: "Token User" }, testNotes: "", ownerApprovedAt: null, shippedRelease: null, triageOutcome: null, ...data }; created.push(r); return r; } },
    feedbackEvent: { create: async ({ data }: { data: Record<string, unknown> }) => void events.push(data) },
  };
  return { db: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("../src/lib/audit", () => ({ audit: async () => {} }));

import { createFeedbackAsAgent } from "../src/lib/feedback/service";

const user = { id: "u1", email: "t@example.com" };

describe("createFeedbackAsAgent", () => {
  it("creates a Triaged + Accepted item with the submitter and scope, and records events", async () => {
    const out = await createFeedbackAsAgent(user, { title: "Add a print button", description: "On the Schedule page.", submitter: "Dr Khalid", scope: "ui_small" });
    expect(out.status).toBe("triaged");
    expect(out.triage).toBe("accepted");
    expect(out.scope).toBe("ui_small");
    expect(out.description).toBe("Submitted by: Dr Khalid\n\nOn the Schedule page.");
    expect(created[0]).toMatchObject({ source: "mcp", authorId: "u1", kind: "FEEDBACK" });
    expect(events.map((e) => e.field)).toEqual(["status", "triage", "scope"]);
  });
  it("needs a title and submitter, and a valid scope", async () => {
    await expect(createFeedbackAsAgent(user, { title: "", submitter: "A" })).rejects.toMatchObject({ status: 400 });
    await expect(createFeedbackAsAgent(user, { title: "T", submitter: " " })).rejects.toMatchObject({ code: "bad_submitter" });
    await expect(createFeedbackAsAgent(user, { title: "T", submitter: "A", scope: "huge" })).rejects.toMatchObject({ code: "bad_scope" });
  });
  it("refuses patient information", async () => {
    await expect(createFeedbackAsAgent(user, { title: "Fix chart", description: "MRN: 123456 cannot open", submitter: "A" })).rejects.toMatchObject({ status: 422, code: "possible_phi" });
    await expect(createFeedbackAsAgent(user, { title: "T", submitter: "a@b.com" })).rejects.toMatchObject({ status: 422 });
  });
});
