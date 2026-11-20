import { describe, expect, it } from "vitest";
import { liveBadge, rowHover, rowSnippet } from "../src/lib/feedback/rowText";

describe("rowSnippet", () => {
  it("adds the start of the description when the title is short, flattened to one line", () => {
    expect(rowSnippet("Fix header", "The header\n\nwraps on phones")).toBe("The header wraps on phones");
  });
  it("skips the Submitted by line of MCP items", () => {
    expect(rowSnippet("Fix header", "Submitted by: Dr. Razak\n\nIt wraps")).toBe("It wraps");
  });
  it("is empty for a long title or no description, and truncates long text", () => {
    expect(rowSnippet("x".repeat(80), "desc")).toBe("");
    expect(rowSnippet("Short", "   ")).toBe("");
    const s = rowSnippet("Short", "a ".repeat(200));
    expect(s.length).toBeLessThanOrEqual(160);
    expect(s.endsWith("…")).toBe(true);
  });
});
describe("rowHover and liveBadge", () => {
  it("hover has the title and description", () => expect(rowHover("T", "D  e")).toBe("T — D e"));
  it("badge only for released items with a stored number", () => {
    expect(liveBadge("released", 84)).toBe("Live in production, Web 1.84");
    expect(liveBadge("released", null)).toBeNull();
    expect(liveBadge("on_staging", 84)).toBeNull();
  });
});
