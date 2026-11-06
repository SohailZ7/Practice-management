import { beforeEach, describe, expect, it } from "vitest";
import { clearEvents, record, recentEvents, routeTemplate, safeCode, scrub } from "../src/lib/diagnostics";

describe("diagnostics carry no patient data", () => {
  beforeEach(() => clearEvents());
  it("removes ids from routes and drops the query", () => {
    expect(routeTemplate("/api/desktop/v1/notes/visits/ckx12abc34def56/transcript?date=2026-11-05")).toBe("/notes/visits/:id/transcript");
    expect(routeTemplate("/api/desktop/v1/notes/visits?date=2026-11-05&q=Jane")).toBe("/notes/visits");
  });
  it("scrubs emails, urls and number runs from free text", () => {
    expect(scrub("failed for jane.doe@x.com at https://a.b/c?mrn=123456 code 4040")).toBe("failed for [email] at [url] code #");
    expect(scrub("x".repeat(500)).length).toBe(120);
  });
  it("keeps only short lower-case server codes", () => {
    expect(safeCode("bad_provider")).toBe("bad_provider");
    expect(safeCode("Jane Doe is not found")).toBeUndefined();
    expect(safeCode(null)).toBeUndefined();
  });
  it("keeps at most 50 events and scrubs detail on record", () => {
    for (let i = 0; i < 60; i++) record({ kind: "js", code: "Error", detail: `bad 12345 a@b.co` }, false);
    expect(recentEvents().length).toBe(50);
    expect(recentEvents()[0].detail).toBe("bad # [email]");
  });
});
