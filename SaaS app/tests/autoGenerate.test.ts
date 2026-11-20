import { describe, it, expect } from "vitest";
import { shouldAutoGenerate } from "../src/lib/notes/autoGenerate";
import { buildCsp, isPdfPreviewPath } from "../src/lib/security/csp";

const v = { status: "scheduled", hasTranscript: true, trackingOnly: false, documents: [] as unknown[] };

describe("auto-start document generation on Seen", () => {
  it("opens the Generate flow when a visit with a transcript becomes Seen", () => {
    expect(shouldAutoGenerate(v, "seen", true)).toBe(true);
  });
  it("does nothing for other statuses, a repeat Seen, no transcript, tracking-only, existing docs or read-only users", () => {
    expect(shouldAutoGenerate(v, "no_show", true)).toBe(false);
    expect(shouldAutoGenerate({ ...v, status: "seen" }, "seen", true)).toBe(false);
    expect(shouldAutoGenerate({ ...v, hasTranscript: false }, "seen", true)).toBe(false);
    expect(shouldAutoGenerate({ ...v, trackingOnly: true }, "seen", true)).toBe(false);
    expect(shouldAutoGenerate({ ...v, documents: [{}] }, "seen", true)).toBe(false);
    expect(shouldAutoGenerate(v, "seen", false)).toBe(false);
  });
});

describe("PDF preview framing", () => {
  it("only the document PDF route may be framed, and only by our own pages", () => {
    expect(isPdfPreviewPath("/api/notes/visits/v1/documents/d1/pdf")).toBe(true);
    expect(isPdfPreviewPath("/api/notes/visits/v1/documents/d1")).toBe(false);
    expect(isPdfPreviewPath("/notes")).toBe(false);
    expect(buildCsp("n", false, { ancestorsSelf: true })).toContain("frame-ancestors 'self'");
    expect(buildCsp("n")).toContain("frame-ancestors 'none'");
  });
  it("a page can frame its own origin for the preview, nothing else", () => {
    const csp = buildCsp("n", false, { frame: ["'self'"] });
    expect(csp).toContain("frame-src 'self'");
    expect(csp).not.toMatch(/frame-src[^;]*https?:/);
  });
});
