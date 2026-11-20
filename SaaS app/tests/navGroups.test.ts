import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const shell = readFileSync("src/components/AppShell.tsx", "utf8");

describe("left navigation groups", () => {
  it("has CLINICAL, OPERATIONS and MANAGE with the agreed entries", () => {
    for (const l of ['group("CLINICAL"', 'group("OPERATIONS"', ">MANAGE<"]) expect(shell).toContain(l);
    for (const href of ['"/patients"', '"/schedule"', '"/billing"', '"/reports"', '"/tasks"', '"/employees"', '"/ledger"', '"/feedback"', '"/settings"', '"/admin"']) expect(shell).toContain(`href: ${href}`);
  });
  it("maps access: Patients = notes, Reports = billing", () => {
    expect(shell).toMatch(/"\/patients"[^\n]*levels\.notes === "none"/);
    expect(shell).toMatch(/"\/reports"[^\n]*levels\.billing === "none"/);
  });
});
