import { describe, expect, it } from "vitest";
import { promoteBlocker } from "../src/lib/promote";
const v = { id: "1", initials: "A.B.", program: "IOP", appointmentType: "x", providerName: "p", hasTranscript: true, documentCount: 0 } as const;
describe("promote reasons", () => {
  it("names why a visit cannot be promoted", () => {
    expect(promoteBlocker({ ...v })).toContain("Full names");
    expect(promoteBlocker({ ...v, fullName: "Ann Bee", hasTranscript: false })).toContain("Record the visit");
    expect(promoteBlocker({ ...v, fullName: "Ann Bee" })).toBe("");
  });
});
