import { describe, expect, it } from "vitest";
import { detectLinkType, normalizeUrl } from "../src/lib/links";
import { addDays, dueLabel, isISODate, startOfWeek } from "../src/lib/dates";

describe("detectLinkType (same rules as the Todo App)", () => {
  it.each([
    ["https://acme.webex.com/meet/x", "webex"],
    ["https://github.com/o/r/pull/12", "pr"],
    ["https://gitlab.com/o/r/-/merge_requests/3", "pr"],
    ["https://x.test/notes.md", "markdown"],
    ["https://x.test/plan.docx", "doc"],
    ["https://docs.google.com/document/d/1", "doc"],
    ["https://example.com", "link"],
  ])("%s -> %s", (url, type) => {
    expect(detectLinkType(url)).toBe(type);
  });
});

describe("normalizeUrl", () => {
  it("adds https and rejects non-http schemes", () => {
    expect(normalizeUrl("example.com/a")).toBe("https://example.com/a");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });
});

describe("dueLabel", () => {
  const today = "2026-10-17";
  it("matches the Todo App pill rules", () => {
    expect(dueLabel(null, today).text).toBe("+ Due date");
    expect(dueLabel("2026-10-17", today).text).toBe("Today");
    expect(dueLabel("2026-10-18", today).text).toBe("Tomorrow");
    expect(dueLabel("2026-10-14", today)).toEqual({ text: "Overdue 3d", className: "due-overdue" });
    expect(dueLabel("2026-10-29", today).text).toBe("Oct 29");
  });
});

describe("date helpers", () => {
  it("validates ISO dates", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-02-28")).toBe(true);
  });
  it("finds Monday and adds days across month ends", () => {
    expect(startOfWeek("2026-10-17")).toBe("2026-10-12"); // Saturday -> Monday
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});
