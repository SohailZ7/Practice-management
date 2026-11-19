import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { canSeeFullNames, nameLabel } from "../src/lib/fullNames";
import { parsePrefs, DEFAULT_PREFS } from "../src/lib/prefs";
import { PatientName } from "../src/components/PatientName";

const css = readFileSync("src/app/globals.css", "utf8");

describe("See full names", () => {
  it("is off by default, like the Desktop app, and only a true value turns it on", () => {
    expect(DEFAULT_PREFS.fullNames).toBe(false);
    expect(parsePrefs(null).fullNames).toBe(false);
    expect(parsePrefs('{"fullNames":"yes"}').fullNames).toBe(false);
    expect(parsePrefs('{"fullNames":true}').fullNames).toBe(true);
  });
  it("the label flips between initials and full name", () => {
    const v = { initials: "AL", fullName: "Test Person" };
    expect(nameLabel(v, false)).toBe("AL");
    expect(nameLabel(v, true)).toBe("Test Person");
    expect(nameLabel({ initials: "AL" }, true)).toBe("AL");
  });
  it("only admins and providers an admin allowed may be sent full names", () => {
    expect(canSeeFullNames({ role: "PROVIDER", showFullNames: true })).toBe(true);
    expect(canSeeFullNames({ role: "PROVIDER", showFullNames: false })).toBe(false);
    expect(canSeeFullNames({ role: "STAFF", showFullNames: true })).toBe(false);
  });
  it("PatientName carries both names; css shows initials unless the switch is on, privacy wins", () => {
    const html = renderToStaticMarkup(createElement(PatientName, { initials: "AL", fullName: "Test <b>Person</b>" }));
    expect(html).toContain('data-initials="AL"');
    expect(html).toContain("Test &lt;b&gt;Person");
    expect(renderToStaticMarkup(createElement(PatientName, { initials: "AL" }))).toBe("AL");
    expect(css).toMatch(/html:not\(\[data-fullnames="on"\]\) \.pname[^{]*\{\s*font-size:\s*0/);
    expect(css).toMatch(/\[data-privacy="on"\] \.pname/);
  });
  it("screens use the shared component, not their own name logic", () => {
    for (const f of ["src/components/notes/VisitsTable.tsx", "src/components/notes/VisitDrawer.tsx", "src/app/page.tsx"])
      expect(readFileSync(f, "utf8")).toContain("<PatientName");
  });
});

describe("Tasks list compact", () => {
  it("the Recurring tasks category pill is replaced by the repeat icon", async () => {
    const src = readFileSync("src/components/TaskBoard.tsx", "utf8");
    expect(src).toMatch(/isRecurringCategory\(categoryName\)/);
    expect(src).toMatch(/\{!hideCategory && \(/);
    const m = src.match(/isRecurringCategory = \(name: string\) => (\/.*\/i)\.test/);
    const re = new RegExp(m![1].slice(1, -2), "i");
    expect(re.test("Recurring tasks")).toBe(true);
    expect(re.test("Billing")).toBe(false);
  });
});
