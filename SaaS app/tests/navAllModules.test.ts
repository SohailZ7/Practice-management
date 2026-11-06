import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("nav lists every module", () => {
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");
  it("never hides a module for lack of access, it marks it locked", () => {
    expect(shell).not.toMatch(/if \(levels\.\w+ !== "none"\) items\.push/);
    for (const m of ["tasks", "employees", "billing", "ledger"]) expect(shell).toMatch(new RegExp(`locked: levels\\.${m} === "none"`));
    // Notes and Schedule are one tab: locked only when both are off, and there is no separate Notes item.
    expect(shell).toContain('locked: levels.schedule === "none" && levels.notes === "none"');
    expect(shell).not.toContain('label: "Notes"');
  });
  it("denied page says the module is not accessible", () => {
    expect(readFileSync("src/app/denied/page.tsx", "utf8")).toContain("do not have access to this module");
  });
});
