import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []; });
}

describe("no native browser pop-ups", () => {
  it("every confirmation is asked in the page (askConfirm), never window.confirm / alert", () => {
    const bad = walk("src").filter((f) => !f.endsWith("lib/confirm.ts")).filter((f) => /window\.(confirm|alert|prompt)\(|[^.\w](confirm|alert)\(/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")));
    expect(bad).toEqual([]);
  });
});
