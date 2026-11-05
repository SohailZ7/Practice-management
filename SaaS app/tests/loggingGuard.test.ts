import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const src = files("src");

describe("logging guard: no PHI in logs or audit details", () => {
  it("has no console.log/info/debug in src", () => {
    const bad = src.filter((f) => /console\.(log|info|debug)\(/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  it("audit details never interpolate content-bearing values", () => {
    const risky = /\$\{[^}]*\b(transcript|markdown|content|values|body|patientName|fileName|file\.name|initials|note)\b(?![^}]*(length|size))[^}]*\}/;
    // Booleans/dates derived from those values are fine (flags, not content).
    const safe = /initials \? "y"|isDraft\(markdown\)|values\.consentDate/;
    const hits: string[] = [];
    for (const f of src) {
      if (f.endsWith("lib/audit.ts")) continue;
      for (const line of readFileSync(f, "utf8").split("\n")) {
        if (/\baudit\(/.test(line) && risky.test(line) && !safe.test(line)) hits.push(`${f}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
