import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every pop-up must go through src/Modal.tsx (drawn on <body>, header/body/footer, buttons that wrap). A hand-made
// fixed-position overlay inside a table cell is what once rendered the transcript window right-aligned and cut off.
describe("pop-ups", () => {
  const files = readdirSync("src").filter((f) => f.endsWith(".tsx") && f !== "Modal.tsx");
  it.each(files)("%s makes no overlay of its own", (f) => {
    const src = readFileSync(`src/${f}`, "utf8");
    expect(src).not.toMatch(/aria-modal/);
    expect(src).not.toMatch(/position:\s*"fixed"/);
  });
  it("the table's button cell does not force right-aligned no-wrap text", () => {
    expect(readFileSync("src/App.tsx", "utf8")).not.toMatch(/textAlign:\s*"right",\s*whiteSpace:\s*"nowrap"/);
  });
});

// The Mac webview draws <datalist> as a detached, unstyled popup far from its field. Use Combobox (src/Fields.tsx).
describe("native autocomplete", () => {
  const files = readdirSync("src").filter((f) => f.endsWith(".tsx"));
  it.each(files)("%s has no <datalist> or list= attribute", (f) => {
    const src = readFileSync(`src/${f}`, "utf8");
    expect(src).not.toMatch(/<datalist/);
    expect(src).not.toMatch(/\blist=\{/);
  });
});
