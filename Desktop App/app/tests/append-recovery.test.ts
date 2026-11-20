import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("a crashed appended recording keeps the earlier text", () => {
  it("passes the earlier text and its time line to the recorder when an append starts", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/startRecording\(true, \{[^}]*earlierText: earlier\.current\?\.text[^}]*separator:/);
    const eng = read("src/lib/engine.ts");
    expect(eng).toMatch(/earlierText: ctx\?\.earlierText \?\? null/);
    expect(eng).toMatch(/separator: ctx\?\.separator \?\? null/);
    const rust = read("src-tauri/src/lib.rs");
    expect(rust).toMatch(/earlier_text: Option<String>, separator: Option<String>/);
    expect(rust).toMatch(/earlier: earlier_text\.unwrap_or_default\(\)/);
  });

  it("says plainly that an unlinked recovered recording has not changed the visit", () => {
    expect(read("src/lib/queue.ts")).toContain("Recovered recording saved. The visit has not changed yet. Link it under Needs link.");
  });

  it("the link call can carry the server's append mode and keeps a blocked link safe in the inbox", () => {
    expect(read("src/lib/api.ts")).toMatch(/mode\?: "append"/);
    expect(read("src/lib/queue.ts")).toContain("the visit already has different text, so it was not changed");
  });
});
