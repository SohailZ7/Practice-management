import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { parsePrefs, initialsFor, DEFAULT_PREFS } from "../src/lib/prefs";
import { Phi } from "../src/components/Phi";

describe("display preferences", () => {
  it("bad, empty or hostile stored values fall back to defaults", () => {
    for (const raw of [null, "", "{", "[]", "null", '"x"', "42"]) expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
  });
  it("only true switches things on", () => {
    expect(parsePrefs('{"compact":true,"privacy":"yes"}')).toEqual({ compact: true, privacy: false });
  });
  it("initials handle odd names", () => {
    expect(initialsFor("Emma Wilson")).toBe("EW");
    expect(initialsFor("  Mary  Ann  Smith ")).toBe("MA");
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("Cher")).toBe("C");
  });
  it("a patient name carries its initials for privacy mode and stays escaped", () => {
    const html = renderToStaticMarkup(createElement(Phi, { name: "Ann Lee <b>x</b>" }));
    expect(html).toContain('data-initials="AL"');
    expect(html).not.toContain("<b>");
  });
  it("css hides the full name and shows initials in privacy mode, and defines compact", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\[data-privacy="on"\] \.phi\s*\{\s*font-size:\s*0/);
    expect(css).toMatch(/attr\(data-initials\)/);
    expect(css).toMatch(/\[data-density="compact"\]/);
  });
});
