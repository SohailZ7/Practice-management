import { describe, expect, it } from "vitest";
import { feedbackShape } from "../src/lib/mcpApi/feedbackApi";
import type { FeedbackOut } from "../src/lib/feedback/rules";

describe("feedback API shape", () => {
  it("carries description, submitter name and status, never an email or author id", () => {
    const item = { id: "f1", kind: "FEEDBACK", title: "t", description: "d", authorName: "Test Person", createdAt: "2026-11-19T00:00:00.000Z", updatedAt: "2026-11-19T00:00:00.000Z", mine: true, status: "new", triage: null, scope: null, testNotes: "", ownerApproved: false, release: null } as unknown as FeedbackOut;
    const out = feedbackShape(item) as Record<string, unknown>;
    expect(out).toMatchObject({ id: "f1", description: "d", submitter: "Test Person", status: "new" });
    expect(Object.keys(out)).not.toContain("email");
    expect(Object.keys(out)).not.toContain("authorId");
    expect(Object.keys(out)).not.toContain("mine");
  });
});
