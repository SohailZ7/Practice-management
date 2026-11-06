import { describe, expect, it } from "vitest";
import { VISIT_STATUSES, statusLabel, statusTone, statusValue } from "../src/lib/visitStatus";
import { ApiFailure, visitErrorMessage } from "../src/lib/api";

describe("visit status", () => {
  it("has the web's five statuses in order", () => {
    expect(VISIT_STATUSES.map((s) => s.value)).toEqual(["scheduled", "seen", "note_signed", "no_show", "cancelled"]);
    expect(statusLabel("note_signed")).toBe("Note signed");
    expect(statusTone("no_show")).toBe("bad");
    expect(statusTone("note_signed")).toBe("done");
  });
  it("shows a missing or unknown status as Scheduled", () => {
    expect(statusValue(undefined)).toBe("scheduled");
    expect(statusValue("weird")).toBe("scheduled");
    expect(statusLabel("weird")).toBe("Scheduled");
  });
  it("explains a refused status change", () => {
    expect(visitErrorMessage(new ApiFailure(403, "forbidden"))).toContain("permission");
    expect(visitErrorMessage(new ApiFailure(400, "bad_status"))).toContain("status");
  });
});
