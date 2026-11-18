import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { EncounterList } from "../src/components/billing/EncounterList";

const css = readFileSync("src/app/globals.css", "utf8");
const filters = { q: "", from: "", to: "", programId: "", status: "all", mrn: "any", by: "", show: "active" } as never;
const row = (i: number, over: object = {}) => ({
  id: "e" + i, patientId: "p" + i, patientName: "Patient " + i, date: "2026-11-17", program: "BIOP-AM", mrn: "M" + i, icd10Codes: ["F33.1"],
  chargeCode: "99213", note: "", enteredBy: "Sohail", getixEntered: false, getixEnteredAt: null, deleted: false, canChange: true, ...over,
});
const render = (rows: object[], isAdmin = true) =>
  renderToStaticMarkup(createElement(EncounterList as never, { initialRows: rows, initialFilters: filters, programs: [], people: [], isAdmin, canEdit: true } as never));

describe("Billing list states", () => {
  it("empty shows a plain message, not a blank table", () => {
    const html = render([]);
    expect(html).toContain("No encounters match.");
    expect(html).toContain("Entry into GetIX stays a manual step");
  });
  it("300 rows render without error and stage counts add up", () => {
    const rows = Array.from({ length: 300 }, (_, i) => row(i, { getixEntered: i % 3 === 0, mrn: i % 5 === 0 ? null : "M" + i }));
    const html = render(rows);
    expect((html.match(/<tr/g) ?? []).length).toBe(301);
    expect(html).toContain("300 shown");
  });
  it("very long names and notes stay inside the cell (no raw overflow) and are escaped", () => {
    const html = render([row(1, { patientName: "A".repeat(200) + " <script>x</script>", note: "n".repeat(500) })]);
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(css).toMatch(/\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  });
  it("deleted rows show Deleted and are excluded from stage counts", () => {
    const html = render([row(1, { deleted: true }), row(2)]);
    expect(html).toContain("Deleted");
  });
  it("a missing MRN says so in words", () => {
    expect(render([row(1, { mrn: null })])).toContain("No MRN yet");
  });
});

describe("style rules the screens rely on", () => {
  it("light, dark and system themes are all defined", () => {
    expect(css).toMatch(/\[data-theme="dark"\]/);
    expect(css).toMatch(/\[data-theme="light"\]/);
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
  });
  it("narrow screens have a rule (375px)", () => {
    expect(css).toMatch(/@media \(max-width: 7\d\dpx\)/);
  });
  it("keyboard focus is visible", () => {
    expect(css).toMatch(/:focus-visible/);
  });
  it("reduced motion is honoured", () => {
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
