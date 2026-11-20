import { describe, expect, it } from "vitest";
import { sameProvider, suggestVisit, localParts, type SuggestVisit } from "../src/lib/notes/suggestVisit";

const v = (o: Partial<SuggestVisit>): SuggestVisit => ({ id: "v", visitDate: "2026-11-18", apptTime: "", startTime: "09:00", providerName: "Dr. Razak", status: "scheduled", transcript: "", initials: "A.B.", ...o });
// 2026-11-18 17:05 UTC = 09:05 Pacific.
const at = new Date("2026-11-18T17:05:00Z");

describe("sameProvider", () => {
  it("ignores titles and matches on last name", () => {
    expect(sameProvider("Dr. Razak", "Abdul Razak")).toBe(true);
    expect(sameProvider("Razak, MD", "razak")).toBe(true);
    expect(sameProvider("Dr. Chen", "Abdul Razak")).toBe(false);
    expect(sameProvider("", "Abdul Razak")).toBe(false);
  });
});
describe("localParts", () => {
  it("uses practice time, not UTC", () => expect(localParts(at)).toEqual({ date: "2026-11-18", minutes: 545 }));
  it("rolls back the date after midnight UTC", () => expect(localParts(new Date("2026-11-19T03:00:00Z")).date).toBe("2026-11-18"));
});
describe("suggestVisit", () => {
  it("picks the same-day same-provider visit nearest in time, high confidence", () => {
    const s = suggestVisit({ recordedAt: at }, "Abdul Razak", [v({ id: "a", startTime: "09:00" }), v({ id: "b", startTime: "13:00" }), v({ id: "c", providerName: "Dr. Chen", startTime: "09:00" })]);
    expect(s?.visitId).toBe("a");
    expect(s?.confidence).toBe("high");
  });
  it("returns null without a same-day same-provider visit, or for cancelled ones", () => {
    expect(suggestVisit({ recordedAt: at }, "Abdul Razak", [v({ visitDate: "2026-11-17" })])).toBeNull();
    expect(suggestVisit({ recordedAt: at }, "Abdul Razak", [v({ status: "cancelled" })])).toBeNull();
    expect(suggestVisit({ recordedAt: at }, "Someone Else", [v({})])).toBeNull();
  });
  it("lowers confidence for far times and for ties", () => {
    expect(suggestVisit({ recordedAt: at }, "Razak", [v({ startTime: "14:00" })])?.confidence).toBe("low");
    expect(suggestVisit({ recordedAt: at }, "Razak", [v({ id: "a" }), v({ id: "b" })])?.confidence).not.toBe("high");
  });
  it("falls back to the apptTime text and prefers a visit with no transcript", () => {
    const s = suggestVisit({ recordedAt: at }, "Razak", [v({ id: "a", startTime: null, apptTime: "9:00", transcript: "x" }), v({ id: "b", startTime: null, apptTime: "9:00" })]);
    expect(s?.visitId).toBe("b");
  });
});
