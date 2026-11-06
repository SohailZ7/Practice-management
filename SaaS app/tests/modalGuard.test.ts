import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
const files = walk(path.join(__dirname, "..", "src"));
const css = readFileSync(path.join(__dirname, "..", "src", "app", "globals.css"), "utf8");

describe("one shared Modal", () => {
  it("no component draws its own overlay or fixed dialog (use components/Modal.tsx)", () => {
    const offenders = files.filter((f) => !/Modal\.tsx$|IdleLogoff\.tsx$/.test(f) && /modal-back|notes-overlay|position:\s*"fixed"/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.basename(f))).toEqual([]);
  });
  it("the Modal is portalled to the body and has header, body and footer regions that wrap and scroll", () => {
    const m = readFileSync(path.join(__dirname, "..", "src", "components", "Modal.tsx"), "utf8");
    expect(m).toMatch(/createPortal\(/);
    expect(m).toMatch(/document\.body/);
    for (const c of ["modal-head", "modal-notices", "modal-body", "modal-foot"]) expect(css).toContain(`.${c}`);
    expect(css).toMatch(/\.modal-foot \{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.modal-body \{[^}]*overflow: auto/);
  });
});

describe("themed form controls", () => {
  it("number, time, password, search and datetime-local inputs get the themed style (dark theme included)", () => {
    const rule = /(input\[type=text\][^{]*)\{/.exec(css)?.[1] ?? "";
    for (const t of ["number", "time", "password", "search", "datetime-local", "month"]) expect(rule).toContain(`input[type=${t}]`);
  });
});
