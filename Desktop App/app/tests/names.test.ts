import { describe, expect, it } from "vitest";
import { canShowFullNames, displayVisits } from "../src/lib/names";
import type { Visit } from "../src/lib/api";

const v = (o: Partial<Visit>): Visit => ({ id: "1", initials: "A.B.", program: "", appointmentType: "", providerName: "", hasTranscript: false, documentCount: 0, ...o });

describe("full names", () => {
  it("is offered only when the server sent a name", () => {
    expect(canShowFullNames([v({})])).toBe(false);
    expect(canShowFullNames(null)).toBe(false);
    expect(canShowFullNames([v({ fullName: "Alex Bell" })])).toBe(true);
  });
  it("shows initials unless asked, and keeps initials for file names", () => {
    const list = [v({ fullName: "Alex Bell" }), v({ id: "2", initials: "C.D." })];
    expect(displayVisits(list, false)[0].initials).toBe("A.B.");
    const on = displayVisits(list, true);
    expect(on[0].initials).toBe("Alex Bell");
    expect(on[0].realInitials).toBe("A.B.");
    expect(on[1].initials).toBe("C.D.");
  });
});
