import { describe, expect, it } from "vitest";
import { dropReady, COLS, type UnmatchedReport } from "../src/lib/unify/unmatched";
import { readFileSync } from "node:fs";

const ok: UnmatchedReport = { sourceNoPatient: 5, inTarget: 4, linkedToVisit: 1, unaccounted: 0, contentDiffers: 0, patientNoVisit: 0, targetTotal: 4 };

describe("drop readiness", () => {
  it("passes only when every no-patient row is accounted for and identical", () => {
    expect(dropReady(ok).ok).toBe(true);
    expect(dropReady({ ...ok, unaccounted: 1 }).ok).toBe(false);
    expect(dropReady({ ...ok, contentDiffers: 1 }).ok).toBe(false);
    expect(dropReady({ ...ok, patientNoVisit: 2 }).ok).toBe(false);
    expect(dropReady({ ...ok, inTarget: 3 }).ok).toBe(false);
  });
  it("copies every ScheduleEntry column the app uses, same id", () => {
    const s = readFileSync("prisma/schema.prisma", "utf8");
    const block = /model UnmatchedAppointment \{[\s\S]*?\n\}/.exec(s)![0];
    for (const c of COLS) expect(block).toMatch(new RegExp(`\\n\\s+${c}\\s`));
  });
});
