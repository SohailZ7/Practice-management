import { describe, expect, it } from "vitest";
import { addedSeparator, combineTranscript } from "../src/lib/append";

describe("adding a recording to an existing transcript", () => {
  it("puts the earlier text first, then a time line, then the new text", () => {
    const sep = addedSeparator(new Date(2026, 10, 5, 15, 42));
    expect(sep).toMatch(/--- Added .*42.* ---/);
    const all = combineTranscript("first part  ", sep, "second part");
    expect(all.startsWith("first part\n")).toBe(true);
    expect(all.endsWith("second part")).toBe(true);
    expect(all.indexOf("first part")).toBeLessThan(all.indexOf("second part"));
  });
  it("is just the new text when nothing came before", () => {
    expect(combineTranscript("  ", "\n--\n", "new")).toBe("new");
  });
});
