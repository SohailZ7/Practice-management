// Layout rules from the approved Language board, enforced on the stylesheet and the markup so a restyle cannot
// bring back oversized buttons, a filled "sign in again" while signed in, or clipped helper text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles.css", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

function buttonRules(): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.split(",").some((s) => /(^|\s)button(\.[\w-]+)*$/.test(s.trim())) && !/menu-item|nav\.tabs/.test(sel)) out.push({ sel, body: m[2] });
  }
  return out;
}

describe("button size and shape (Language board)", () => {
  const rules = buttonRules();
  it("finds the button rules", () => expect(rules.length).toBeGreaterThan(3));
  it("no button rule sets text above 13px", () => {
    for (const r of rules) {
      const f = r.body.match(/font-size:\s*([\d.]+)(px|rem)/);
      if (f) expect(f[2] === "px" ? +f[1] : +f[1] * 13, r.sel).toBeLessThanOrEqual(13);
    }
  });
  it("no button rule uses padding above 14px sideways or 12px vertically", () => {
    for (const r of rules) {
      const p = r.body.match(/(?:^|[;\s])padding:\s*([^;]+)/);
      if (!p) continue;
      const px = p[1].trim().split(/\s+/).map((v) => (v.endsWith("rem") ? parseFloat(v) * 13 : parseFloat(v)));
      expect(px[0], r.sel).toBeLessThanOrEqual(12);
      expect(px[1] ?? px[0], r.sel).toBeLessThanOrEqual(14);
    }
  });
  it("the final base button is 12px with 7px corners and 9-14px padding", () => {
    const last = [...css.matchAll(/(?:^|\n)button \{([^}]*)\}/g)].pop()![1];
    expect(last).toMatch(/font-size:\s*12px/);
    expect(last).toMatch(/border-radius:\s*7px/);
    expect(last).toMatch(/padding:\s*9px 14px/);
  });
  it("every button corner is 7px", () => {
    for (const r of rules) { const m = r.body.match(/border-radius:\s*(\d+)px/); if (m) expect(+m[1], r.sel).toBe(7); }
  });
});

describe("Setup screen", () => {
  it("'Sign in again with Google' is a quiet secondary while signed in", () => {
    expect(app).toMatch(/className=\{signedIn \? "secondary" : undefined\}/);
  });
  it("the diagnostics helper sits in a wrapping row and can shrink and wrap", () => {
    expect(app).toMatch(/<div className="row wrap">[\s\S]{0,900}Send diagnostics<\/button>\s*<span className="small helper">/);
    expect(css).toMatch(/\.row\.wrap \{ flex-wrap: wrap; \}/);
    expect(css).toMatch(/\.row \.helper \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
  });
  it("Appearance options are compact (7px corners, 9-14px padding, 12px text, in a wrapping row)", () => {
    expect(css).toMatch(/\.theme-options \{[^}]*flex-flow: row wrap/);
    expect(css).toMatch(/\.theme-option \{[^}]*padding: 9px 14px;[^}]*border-radius: 7px;[^}]*font-size: 12px/);
  });
  it("text and columns can wrap and shrink, never clip", () => {
    expect(css).toMatch(/\.card, \.content-inner, \.content \{ min-width: 0; max-width: 100%; \}/);
    expect(css).toMatch(/\.small, \.card p, \.card h3 \{ overflow-wrap: anywhere; \}/);
    expect(css).not.toMatch(/\.small\s*\{[^}]*white-space:\s*nowrap/);
  });
});
