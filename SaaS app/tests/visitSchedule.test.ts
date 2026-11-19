import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scheduleFieldsFor } from "@/lib/notes/visitSchedule";

describe("visit to schedule mapping", () => {
  it("a program becomes a track row labelled with the program", () => {
    expect(scheduleFieldsFor({ program: "PM IOP", apptTime: "1:00 PM", appointmentType: "Follow-up" })).toEqual({
      section: "TRACK", timeLabel: "PM IOP", trackName: "PM IOP", typeName: "Follow-up",
    });
  });
  it("no program becomes a psych-eval row at the appointment time", () => {
    expect(scheduleFieldsFor({ program: " ", apptTime: "9:15 AM", appointmentType: "Psych Eval" })).toEqual({
      section: "PSYCH_EVAL", timeLabel: "9:15 AM", trackName: "", typeName: "Psych Eval",
    });
  });
});

describe("wiring", () => {
  const svc = readFileSync("src/lib/notes/visitService.ts", "utf8");
  it("add and edit keep the unified Visit columns in step; the ScheduleEntry mirror is retired", () => {
    expect(svc).toContain("unifiedColumns(");
    expect(svc).not.toContain("syncScheduleForVisit");
    expect(readFileSync("src/lib/notes/visitSchedule.ts", "utf8")).not.toContain("scheduleEntry");
  });
});
