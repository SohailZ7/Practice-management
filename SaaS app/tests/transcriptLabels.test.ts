import { describe, expect, it } from "vitest";
import { applyLabels, sanitizeLabels } from "@/lib/transcript/labels";
import { parseTurns } from "@/lib/transcript/turns";

describe("speaker labels (fake text only)", () => {
  it("cleans untrusted input", () => {
    expect(sanitizeLabels({ "Speaker 1": " Provider ", "Speaker 2": 5, "": "x", same: "same", long: "x".repeat(30) })).toEqual({ "Speaker 1": "Provider" });
    expect(sanitizeLabels(null)).toEqual({});
    expect(sanitizeLabels(["a"])).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`S${i}`, `P${i}`]));
    expect(Object.keys(sanitizeLabels(many))).toHaveLength(8);
  });
  it("renames at display time and merges neighbours, leaving the text untouched", () => {
    const text = "[00:01] Speaker 1: Hi.\n[00:03] Speaker 2: Hello.\n[00:05] Speaker 1: Sleep ok?";
    const before = text;
    const turns = applyLabels(parseTurns(text), { "Speaker 1": "Provider", "Speaker 2": "Provider" });
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ speaker: "Provider", text: "Hi. Hello. Sleep ok?" });
    expect(text).toBe(before);
  });
  it("is a no-op with no labels", () => {
    const t = parseTurns("[00:01] Speaker 1: Hi.");
    expect(applyLabels(t, null)).toBe(t);
  });
});
