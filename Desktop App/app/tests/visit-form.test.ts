import { describe, expect, it } from "vitest";
import { longDate, practiceToday, shiftDate } from "../src/lib/dates";
import { clientNameError, clientNameToSend, formChoices, visitFormErrors } from "../src/lib/visitForm";
import { ApiFailure, visitErrorMessage } from "../src/lib/api";

// 2026-11-05 17:50 in Los Angeles is already 2026-11-06 01:50 UTC: the case that once looked like a lost visit.
const LATE = new Date("2026-11-06T01:50:00Z");

describe("dates (run also with TZ=America/Los_Angeles and TZ=Pacific/Auckland)", () => {
  it("today is the practice's Pacific day, whatever the machine's zone", () => {
    expect(practiceToday(LATE)).toBe("2026-11-05");
    expect(practiceToday(new Date("2026-11-06T07:59:00Z"))).toBe("2026-11-05");
    expect(practiceToday(new Date("2026-11-06T08:01:00Z"))).toBe("2026-11-06");
  });
  it("shifts and prints plain dates without drifting a day", () => {
    expect(shiftDate("2026-11-05", 1)).toBe("2026-11-06");
    expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDate("2026-11-01", 1)).toBe("2026-11-02"); // DST ends on 2026-11-01
    expect(longDate("2026-11-05")).toBe("Thursday, November 5, 2026");
  });
});

describe("Add one visit form", () => {
  const ok = { date: "2026-11-05", patient: "Zed Zulu", time: "9:00 AM", type: "Follow Up", provider: "Dr. A" };
  it("accepts a complete form", () => expect(Object.values(visitFormErrors(ok)).every((m) => m === "")).toBe(true));
  it("blocks the exact state that was sent before: Type and Provider left blank", () => {
    const e = visitFormErrors({ ...ok, type: "", provider: "" });
    expect(e.type).toMatch(/type/i);
    expect(e.provider).toMatch(/provider/i);
  });
  it("flags a one-word client, a bad time and a missing date", () => {
    expect(visitFormErrors({ ...ok, patient: "Zulu" }).patient).not.toBe("");
    expect(visitFormErrors({ ...ok, time: "soon" }).time).not.toBe("");
    expect(visitFormErrors({ ...ok, date: "" }).date).not.toBe("");
  });
  it("an empty time is allowed", () => expect(visitFormErrors({ ...ok, time: "" }).time).toBe(""));
});

describe("choices the form offers", () => {
  const seen = [{ program: "IOP", appointmentType: "Initial Eval", providerName: "Dr. Khalid Ahmed" }];
  it("uses only the server's type and provider lists when it has them (anything else is refused with 400)", () => {
    const c = formChoices({ programs: ["PHP"], appointmentTypes: ["Follow Up"], providers: ["Khalid Ahmed"] }, seen, { provider: "typed" });
    expect(c.appointmentTypes).toEqual(["Follow Up"]);
    expect(c.providers).toEqual(["Khalid Ahmed"]);
    expect(c.programs).toEqual(["IOP", "PHP"]); // programs are free text on the server
  });
  it("falls back to what the day shows when the server has no list", () => {
    const c = formChoices(null, seen, { provider: "" });
    expect(c.appointmentTypes).toEqual(["Initial Eval"]);
    expect(c.providers).toEqual(["Dr. Khalid Ahmed"]);
  });
});

describe("error wording", () => {
  it.each([["bad_type", /type/i], ["bad_provider", /provider/i], ["bad_time", /time/i], ["bad_patient", /First Last/]])("%s", (code, re) => {
    expect(visitErrorMessage(new ApiFailure(400, code))).toMatch(re);
  });
  it("an unknown refusal still shows the status and code instead of nothing", () => {
    expect(visitErrorMessage(new ApiFailure(400, "bad_request"))).toContain("400 bad_request");
    expect(visitErrorMessage(new ApiFailure(500, null))).toContain("500");
  });
});

describe("client name", () => {
  it.each(["Alex Rivera", "Rivera, Alex", "Mary-Jane O'Neil", "Jo Li", "A B", "A. B.", "a, b", "J. Smith", "Smith, J.", "Alex J. Rivera", "José Peña", "Ana de la Cruz"])("accepts %s", (n) => {
    expect(clientNameError(n)).toBe("");
  });
  it.each(["", "Zulu", "asdf", "123 456", "Test 1", "qwrtp zxcvb", "Alex @ Rivera", "a, b1"])("rejects %s", (n) => {
    expect(clientNameError(n)).not.toBe("");
  });
});

describe("middle initials and suffixes", () => {
  it.each(["Alex J. Rivera", "Alex J Rivera", "Rivera, Alex J.", "Mary Jane Watson", "Alex Rivera Jr."])("accepts %s", (n) => {
    expect(clientNameError(n)).toBe("");
  });
  it("keeps a suffix with the last name", () => {
    expect(clientNameToSend("Alex Rivera Jr.")).toBe("Rivera Jr., Alex");
    expect(clientNameToSend("Alex J. Rivera III")).toBe("Rivera III, Alex J.");
    expect(clientNameToSend("Alex J. Rivera")).toBe("Alex J. Rivera");
    expect(clientNameToSend("Rivera, Alex J.")).toBe("Rivera, Alex J.");
  });
});
