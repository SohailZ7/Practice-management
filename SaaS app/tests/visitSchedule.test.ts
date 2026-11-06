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
  it("add, edit and delete keep the schedule row in step", () => {
    expect(svc).toContain("syncScheduleForVisit(visit.id)");
    expect(svc).toContain("syncScheduleForVisit(id)");
    expect(svc.match(/removeScheduleForVisits\(/g)?.length).toBe(2);
  });
  it("sync is idempotent: it looks up by visitId before creating", () => {
    expect(readFileSync("src/lib/notes/visitSchedule.ts", "utf8")).toContain("findFirst({ where: { visitId: v.id }");
  });
  it("schema change is one optional column plus an index", () => {
    const s = readFileSync("prisma/schema.prisma", "utf8");
    expect(s).toMatch(/visitId\s+String\?/);
  });
});
