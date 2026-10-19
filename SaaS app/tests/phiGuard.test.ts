import { describe, expect, it } from "vitest";
import { detectPhi, isPhiBlock, phiBlock, phiMessage } from "../src/lib/phiGuard";

const kinds = (t: string, opts?: Parameters<typeof detectPhi>[1]) => detectPhi(t, opts).map((f) => f.kind).sort();

describe("detectPhi: things that must be caught", () => {
  it.each([
    ["Call back re MRN 12345", ["mrn"]],
    ["mrn: A1234567 needs auth", ["mrn"]],
    ["MRN#998877", ["mrn"]],
    ["Medical record number 445566 missing", ["mrn"]],
    ["see medical record no. 7788-99", ["mrn"]],
    ["ssn on file 123-45-6789", ["ssn"]],
    ["SSN: 123456789", ["ssn"]],
    ["Social Security number 123456789", ["ssn"]],
    ["DOB 3/4/1985", ["dob"]],
    ["dob: 03-04-85", ["dob"]],
    ["D.O.B. 1985-03-04", ["dob"]],
    ["Date of birth: Mar 4, 1985", ["dob"]],
    ["birthdate 4 March 1985", ["dob"]],
    ["Call (425) 555-1234 tomorrow", ["phone"]],
    ["425-555-1234", ["phone"]],
    ["425.555.1234", ["phone"]],
    ["+1 425 555 1234", ["phone"]],
    ["cell 4255551234", ["phone"]],
    ["email zz.patient@example.com the form", ["email"]],
    ["MRN 12345 DOB 1/2/1990 phone 206-555-0100", ["dob", "mrn", "phone"]],
  ])("%s", (text, expected) => {
    expect(kinds(text)).toEqual(expected);
  });

  it("is case-insensitive and tolerant of spacing", () => {
    expect(kinds("mRn   :   AB12345")).toEqual(["mrn"]);
    expect(kinds("DATE OF BIRTH   12/31/1999")).toEqual(["dob"]);
  });
});

describe("detectPhi: ordinary task text must pass", () => {
  it.each([
    "Call insurance about authorization",
    "Submit Q3 billing report by Friday",
    "Order printer toner",
    "MRN needed for the new batch",
    "Add MRN to the encounter form",
    "Follow up on medical record request process",
    "Review the SSN masking policy",
    "Ask about date of birth field validation",
    "Meeting 10/18 at 3pm",
    "Due 2026-10-18",
    "Invoice 4255551234567",
    "Ticket #123-45 and PO 2024-11-0003",
    "Room 101-202-3030 rev 12",
    "Pay $1,234.56 by 10/31/2026",
    "Version 3.4.1985 build",
    "Born to run playlist for the holiday party",
    "Call the front desk",
    "Call 911",
    "Extension 555-1234",
    "",
  ])("%s", (text) => {
    expect(kinds(text)).toEqual([]);
  });

  it("does not treat a plain date without a DOB label as a birth date", () => {
    expect(kinds("Appointment 3/4/1985")).toEqual([]);
  });
  it("rejects impossible SSNs", () => {
    expect(kinds("000-12-3456 666-12-3456 900-12-3456 123-00-4567 123-45-0000")).toEqual([]);
  });
  it("ignores the practice's own staff emails but not others", () => {
    const staff = ["Razak@Practice.example"];
    expect(kinds("Ask razak@practice.example to approve", { ignoreEmails: staff })).toEqual([]);
    expect(kinds("Ask razak@practice.example and zz@gmail.test", { ignoreEmails: staff })).toEqual(["email"]);
  });
});

describe("messages", () => {
  it("names the kinds but never repeats the text", () => {
    const f = detectPhi("MRN 12345 and 206-555-0100");
    const m = phiMessage(f);
    expect(m).toContain("medical record number");
    expect(m).toContain("phone number");
    expect(m).not.toContain("12345");
    expect(m).not.toContain("555");
    expect(m).toContain("Use Billing or Schedule");
  });
  it("builds a block result that is recognised", () => {
    const b = phiBlock(detectPhi("DOB 1/2/1990"));
    expect(isPhiBlock(b)).toBe(true);
    expect(b.kinds).toEqual(["dob"]);
    expect(isPhiBlock({ id: "x" })).toBe(false);
    expect(isPhiBlock(null)).toBe(false);
  });
});
