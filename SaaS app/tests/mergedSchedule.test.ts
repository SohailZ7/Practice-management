import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VISIT_STATUSES, flagsForStatus, isVisitStatus, statusLabel } from "@/lib/notes/visitStatus";

describe("visit statuses", () => {
  it("the final list", () => {
    expect(VISIT_STATUSES.map((s) => s.value)).toEqual(["scheduled", "seen", "note_signed", "no_show", "cancelled"]);
    expect(isVisitStatus("seen")).toBe(true);
    expect(isVisitStatus("done")).toBe(false);
    expect(statusLabel("no_show")).toBe("No-show");
  });
  it("derives the old schedule flags", () => {
    expect(flagsForStatus("seen").completed).toBe(true);
    expect(flagsForStatus("note_signed").completed).toBe(true);
    expect(flagsForStatus("no_show").absent).toBe(true);
    expect(flagsForStatus("cancelled").canceled).toBe(true);
    expect(flagsForStatus("scheduled")).toEqual({ completed: false, absent: false, canceled: false, missed: false });
  });
});

describe("merged Schedule tab", () => {
  const page = readFileSync("src/app/schedule/page.tsx", "utf8");
  it("shows the visit list on the day view and keeps access rules", () => {
    expect(page).toContain("visitsDay");
    expect(page).toContain("embedded");
    expect(page).toContain('canAccess(me, "notes", "view")');
  });
  it("old /notes links redirect to the Schedule day view", () => {
    const n = readFileSync("src/app/notes/page.tsx", "utf8");
    expect(n).toContain("redirect(`/schedule?view=day");
  });
  it("the recorder API carries status both ways", () => {
    expect(readFileSync("src/app/api/desktop/v1/notes/visits/route.ts", "utf8")).toContain("status: v.status");
    expect(readFileSync("src/app/api/desktop/v1/notes/visits/[id]/route.ts", "utf8")).toContain('"status"');
  });
  it("the table has the agreed columns and a single row menu", () => {
    const t = readFileSync("src/components/notes/VisitsTable.tsx", "utf8");
    for (const c of ["Patient", "Time", "Program", "Type", "Status", "Documents", "Generate docs", "row-menu"]) expect(t).toContain(c);
  });
});
