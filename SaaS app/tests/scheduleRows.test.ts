import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/db", () => ({ db: {} }));
const { visitAsEntry, unmatchedAsEntry, byTime } = await import("../src/lib/schedule/rows");

const visit = (o: Record<string, unknown> = {}) =>
  ({ id: "v1", patientId: "p1", visitDate: "2026-11-20", appointmentType: "FollowUp", program: "", apptTime: "10:30", providerName: "Dr A", status: "scheduled", transcript: "", transcriptAt: null, createdByEmail: "x", createdAt: new Date(1), legacyScheduleEntryId: null, backfilledAt: null, startTime: null, endTime: null, timeLabel: null, section: null, trackName: null, providerId: null, encounterId: null, scheduleNotes: null, discharged: null, overdueBasis: null, patient: { lastName: "L", firstName: "F" }, ...o }) as never;

describe("visitAsEntry", () => {
  it("falls back to the program/time fields when the new columns are empty", () => {
    expect(visitAsEntry(visit())).toMatchObject({ id: "v1", section: "PSYCH_EVAL", timeLabel: "10:30", completed: false, visitId: "v1" });
    expect(visitAsEntry(visit({ program: "IOP" }))).toMatchObject({ section: "TRACK", timeLabel: "IOP" });
  });
  it("prefers the unified columns and maps status to the four flags", () => {
    const e = visitAsEntry(visit({ section: "TRACK", timeLabel: "9-10", trackName: "PHP", status: "missed", providerId: "pr1" }));
    expect(e).toMatchObject({ section: "TRACK", timeLabel: "9-10", trackName: "PHP", missed: true, providerId: "pr1" });
  });
});

describe("unmatchedAsEntry", () => {
  it("is a schedule row with no visit", () => {
    expect(unmatchedAsEntry({ id: "u1", date: "2026-11-20", section: "TRACK", timeLabel: "IOP", trackName: "IOP", typeName: "", clientInfo: "x", providerId: null, providerName: "", absent: false, canceled: false, completed: false, missed: false, dedupeKey: "k", importLogId: null, patientId: null, createdAt: new Date(1) })).toMatchObject({ id: "u1", visitId: null, patientId: null });
  });
});

describe("byTime", () => {
  it("exact times first in order, unparsed after by creation", () => {
    const rows = [
      { n: "x", startTime: null, createdAt: new Date(1) },
      { n: "b", startTime: "10:00", createdAt: new Date(3) },
      { n: "a", startTime: "09:00", createdAt: new Date(2) },
    ];
    expect(rows.sort(byTime).map((r) => r.n)).toEqual(["a", "b", "x"]);
  });
});
