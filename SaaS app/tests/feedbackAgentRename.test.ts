import { beforeEach, describe, expect, it, vi } from "vitest";

let row: Record<string, unknown>;
const audits: string[] = [];
vi.mock("../src/lib/db", () => ({
  db: { feedbackItem: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === row.id ? row : null), update: async ({ data }: { data: object }) => (row = { ...row, ...data }) } },
}));
vi.mock("../src/lib/audit", () => ({ audit: async (_a: string, _b: string, d: string) => void audits.push(d) }));

import { renameFeedbackAsAgent, FeedbackError } from "../src/lib/feedback/service";

const user = { id: "mcpuser", email: "a@b.c" };
beforeEach(() => {
  audits.length = 0;
  row = { id: "f1", kind: "FEEDBACK", title: "Feedback", description: "Submitted by: Razak\n\nBody", authorId: "someone-else", createdAt: new Date(), updatedAt: new Date(), author: { name: "Razak" }, status: "released", triageOutcome: "accepted", scope: null, testNotes: "", ownerApprovedAt: null, shippedRelease: 5 };
});

describe("agent rename (title only)", () => {
  it("renames an item the token user did not author, leaving everything else alone", async () => {
    const out = await renameFeedbackAsAgent(user, "f1", "  Visit list shows wrong time  ");
    expect(out.title).toBe("Visit list shows wrong time");
    expect(row.description).toBe("Submitted by: Razak\n\nBody");
    expect(row.status).toBe("released");
    expect(row.authorId).toBe("someone-else");
    expect(audits).toEqual(["f1 FEEDBACK title via mcp"]);
  });
  it("rejects empty, too-long and unknown", async () => {
    await expect(renameFeedbackAsAgent(user, "f1", "  ")).rejects.toMatchObject({ status: 400 });
    await expect(renameFeedbackAsAgent(user, "f1", "x".repeat(201))).rejects.toMatchObject({ status: 400 });
    await expect(renameFeedbackAsAgent(user, "nope", "ok")).rejects.toMatchObject({ status: 404 });
    expect(row.title).toBe("Feedback");
  });
  it("runs the PHI guard", async () => {
    await expect(renameFeedbackAsAgent(user, "f1", "Call 415-555-0134 about the visit")).rejects.toBeInstanceOf(FeedbackError);
    expect(row.title).toBe("Feedback");
  });
});
