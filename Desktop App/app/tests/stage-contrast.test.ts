import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("buttons on the dark recording panel are readable", () => {
  it("every button in the panel's action row is a light-on-dark ghost or the white finish button", () => {
    const row = app.slice(app.indexOf('className="stage-actions"'), app.indexOf("</section>", app.indexOf('className="stage-actions"')));
    const classes = [...row.matchAll(/<button className="([^"]+)"/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThanOrEqual(3);
    for (const c of classes) expect(["ghost", "finish"]).toContain(c);
  });
  it("ghost text (white) and the soft text have at least 4.5:1 contrast on the panel colour", () => {
    expect(ratio("#FFFFFF", "#4A3550")).toBeGreaterThan(4.5);
    expect(ratio("#FFFFFF", "#3C2B40")).toBeGreaterThan(4.5);
    expect(ratio("#D9B9D6", "#4A3550")).toBeGreaterThan(4.5);
    expect(ratio("#3C2B40", "#FFFFFF")).toBeGreaterThan(4.5);
  });
  it("the css gives ghost white text", () => {
    expect(css).toMatch(/\.stage \.stage-actions \.ghost \{[^}]*color: #fff/);
  });
});
