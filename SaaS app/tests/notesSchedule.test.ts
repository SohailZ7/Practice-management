import { describe, expect, it } from "vitest";
import { parseClient, parseSchedule, withoutAge } from "../src/lib/notes/scheduleParse";
import { canRecord, documentsFor } from "../src/lib/notes/documents";
import { patientFolderName, patientInitials } from "../src/lib/notes/patientFolder";

// Every name below is invented. The sheet's real structure is reproduced; its patients are not.
const PROVIDER = "Dr. Example Provider";
const OTHER = "Dr. Someone Else";

const row = (cells: string[]) => cells.join("\t");
const BOARD = [
  row(["Time ", "Type ", "Client Info ", "Absent ", "Canceled", "Provider", "Completed ", "Missed", "Sent to Team"]),
  row(["PE: Select Time ", "Select Type", "", "FALSE", "FALSE", PROVIDER, "FALSE", "FALSE", "Select Option"]),
  row(["2:00: Psych Eval & Admit Order", "PT Onsite Belle", "Alpha Testcase/40F/Insurer/KIOP PM 1", "FALSE", "FALSE", PROVIDER, "FALSE", "FALSE", "Select Option"]),
  row(["5:00: Psych Eval & Admit Order", "Provider Zoom", "Bravo Sample/69F/ Other Insurer /BIOP-PM1", "FALSE", "FALSE", OTHER, "FALSE", "FALSE", "Select Option"]),
  row(["Tracks", "Type", "Client Info", "Absent", "Canceled", "Provider", "Complete", "Column1", "Column2"]),
  row([" KIOP-AM  9:00 - 11:30", "Follow-up & Admit Order", "Charlie Fixture/39M/Insurer/SD from W2 to KIOP PM2", "FALSE", "FALSE", PROVIDER, "FALSE", "FALSE", "Select Option"]),
  row(["BPHP-AM   9:00-12:30", "Follow-up ", "Delta Mockup", "FALSE", "FALSE", PROVIDER, "FALSE", "FALSE", "Select Option"]),
  row([" KPHP-AM 5hr 9:00-1:30", "Follow-up & Discharge Order", "Echo “Eko” Dummy ", "FALSE", "FALSE", PROVIDER, "FALSE", "FALSE", "Select Option"]),
  row([" VIOP-EVE    5:00-7:30", "Follow-up", "Foxtrot Placeholder", "FALSE", "TRUE", PROVIDER, "FALSE", "FALSE", "Select Option"]),
  row(["Select Track", "Select Type", "", "FALSE", "FALSE", "Select Provider", "FALSE", "FALSE", "Select Option"]),
  row(["Column1", "Column2", "Orders Only No Follow Ups", "Column4", "Column8", "Column5", "Column6", "Column7", "Column72"]),
  row(["DC Orders Only ", "KPHP-AM", "Golf Synthetic DC 10/21", "", "FALSE", PROVIDER, "FALSE", "", "Select Option"]),
  row(["H&P: Select Time", "PT: Onsite Kirkland Main", "", "FALSE", "FALSE", "Inpatient Team ", "FALSE", "FALSE", ""]),
].join("\n");

describe("parseClient", () => {
  it("splits name from the age, insurance and note, and keeps the rest as detail", () => {
    expect(parseClient("Alpha Testcase/40F/Insurer/KIOP PM 1")).toEqual({
      lastName: "Testcase", firstName: "Alpha", detail: "F / Insurer / KIOP PM 1",
    });
  });
  it("drops a quoted nickname from the name", () => {
    expect(parseClient('Echo "Eko" Dummy')).toMatchObject({ lastName: "Dummy", firstName: "Echo" });
  });
  it("handles a middle name, a single name and an already-reversed name", () => {
    expect(parseClient("Alpha Beta Testcase")).toMatchObject({ lastName: "Testcase", firstName: "Alpha Beta" });
    expect(parseClient("Madonna")).toMatchObject({ lastName: "Madonna", firstName: "" });
    expect(parseClient("Testcase, Alpha")).toMatchObject({ lastName: "Testcase", firstName: "Alpha" });
  });
  it("strips a trailing discharge date note", () => {
    expect(parseClient("Golf Synthetic DC 10/21")).toMatchObject({ lastName: "Synthetic", firstName: "Golf" });
  });
  it("returns null for blanks and placeholders", () => {
    for (const v of ["", "   ", "Select Type", "Client Info", "Column3"]) expect(parseClient(v)).toBeNull();
  });
});

describe("parseSchedule", () => {
  const r = parseSchedule(BOARD, PROVIDER);

  it("keeps only this provider's rows that have a patient", () => {
    expect(r.entries.map((e) => e.patient!.lastName)).toEqual(["Testcase", "Fixture", "Mockup", "Dummy", "Placeholder", "Synthetic"]);
    expect(r.otherProviders).toEqual([OTHER]);
  });
  it("skips placeholder rows, empty clients, other providers and the inpatient team", () => {
    expect(r.summary.kept).toBe(6);
    expect(r.summary.skippedNoClient).toBeGreaterThan(0);
    expect(r.summary.skippedOtherProvider).toBeGreaterThan(0);
    expect(r.entries.some((e) => /inpatient/i.test(e.provider?.name ?? ""))).toBe(false);
  });
  it("reads the program from the track, and the appointment type from the right column", () => {
    const byName = Object.fromEntries(r.entries.map((e) => [e.patient!.lastName, e]));
    expect(byName.Fixture).toMatchObject({ program: "KIOP-AM", type: "Follow-up & Admit Order" });
    expect(byName.Mockup).toMatchObject({ program: "BPHP-AM", type: "Follow-up" });
    expect(byName.Dummy.program).toBe("KPHP-AM 5hr"); // the 5hr track is distinct from the regular KPHP-AM
    expect(byName.Testcase).toMatchObject({ program: "Psych Eval", type: "Psych Eval & Admit Order" });
    expect(byName.Synthetic.type).toBe("DC Orders Only");
  });
  it("reads the status flags", () => {
    const canceled = r.entries.find((e) => e.patient!.lastName === "Placeholder")!;
    expect(canceled.status.canceled).toBe(true);
    expect(r.entries.find((e) => e.patient!.lastName === "Mockup")!.status.canceled).toBe(false);
  });
  it("keeps every provider when none is given, and copes with a leading date column", () => {
    expect(parseSchedule(BOARD, "").summary.kept).toBe(7);
    const dated = BOARD.split("\n")
      .map((l, i) => (i === 0 ? `Date\t${l}` : i === 1 ? `Wednesday 10/28\t${l}` : `\t${l}`))
      .join("\n");
    expect(parseSchedule(dated, PROVIDER).summary.kept).toBe(6);
  });
  it("matches the provider loosely and returns nothing for an empty paste", () => {
    expect(parseSchedule(BOARD, "Example Provider").summary.kept).toBe(6);
    expect(parseSchedule("", PROVIDER).entries).toEqual([]);
  });
});

describe("documentsFor", () => {
  const labels = (t: string) => documentsFor(t).map((d) => d.label);
  it("maps each appointment type to the documents the owner confirmed", () => {
    expect(labels("Psych Eval & Admit Order")).toEqual(["Psych Eval", "Admit Order"]);
    expect(labels("Follow-up")).toEqual(["Progress Note", "Follow-up"]);
    expect(labels("Follow-up & Admit Order")).toEqual(["Progress Note", "Follow-up", "Admit Order"]);
    expect(labels("Follow-up & Discharge Order")).toEqual(["Progress Note", "Follow-up", "Discharge Order", "Discharge Summary"]);
    expect(labels("DC Orders Only")).toEqual(["Discharge Order", "Discharge Summary"]);
  });
  it("ignores case and spacing on the board", () => {
    expect(labels("follow-up & discharge order")).toEqual(labels("Follow-up & Discharge Order"));
    expect(labels("Follow up ")).toEqual(["Progress Note", "Follow-up"]);
  });
  it("gives nothing for an unknown or empty type", () => {
    expect(labels("")).toEqual([]);
  });
});

describe("canRecord", () => {
  const item = (type: string, status = {}) => ({ type, status: { absent: false, canceled: false, missed: false, ...status } });
  it("allows a normal visit and refuses absent, canceled or missed rows", () => {
    expect(canRecord(item("Follow-up"))).toBe(true);
    expect(canRecord(item("Follow-up", { canceled: true }))).toBe(false);
    expect(canRecord(item("Follow-up", { absent: true }))).toBe(false);
    expect(canRecord(item("Follow-up", { missed: true }))).toBe(false);
  });
  it("refuses a row whose type produces no documents", () => {
    expect(canRecord(item(""))).toBe(false);
  });
});

describe("patientInitials", () => {
  it("gives first and last initials, for the on-screen board", () => {
    expect(patientInitials("Testcase", "Alpha")).toBe("A.T.");
    expect(patientInitials("Mockup", "Delta")).toBe("D.M.");
  });
  it("copes with one name, a middle name and an empty name", () => {
    expect(patientInitials("Madonna", "")).toBe("M.");
    expect(patientInitials("Testcase", "Alpha Beta")).toBe("A.T.");
    expect(patientInitials("", "")).toBe("?");
  });
  it("skips punctuation and quotes", () => {
    expect(patientInitials("O'Neil", "\u201cEko\u201d")).toBe("E.O.");
  });
  it("does not change the folder name, which keeps the full name", () => {
    expect(patientFolderName("Testcase", "Alpha")).toBe("Testcase, Alpha");
  });
});

describe("withoutAge", () => {
  it("keeps the sex but drops the age", () => {
    expect(withoutAge("40F")).toBe("F");
    expect(withoutAge("39M")).toBe("M");
    expect(withoutAge("33FTM")).toBe("FTM");
  });
  it("drops a segment that is only an age", () => {
    expect(withoutAge("40")).toBe("");
  });
  it("leaves insurance, programs and notes alone", () => {
    for (const v of ["Wellpoint", "UHC Medicare dual", "BIOP-PM1", "Sd from W2 to VIOP EVE", "KIOP PM 1"]) {
      expect(withoutAge(v)).toBe(v);
    }
  });
  it("is applied when a schedule is parsed, so no age is stored", () => {
    const line = ["2:00: Psych Eval & Admit Order", "PT Onsite", "Alpha Testcase/40F/Insurer/KIOP PM 1",
      "FALSE", "FALSE", "Dr. Example Provider", "FALSE", "FALSE", "Select Option"].join("\t");
    const r = parseSchedule(`${BOARD}\n${line}`, PROVIDER);
    const row = r.entries.find((e) => e.patient!.firstName === "Alpha")!;
    expect(row.clientInfo).toBe("F / Insurer / KIOP PM 1");
    expect(row.clientInfo).not.toMatch(/\d\d/);
  });
});
