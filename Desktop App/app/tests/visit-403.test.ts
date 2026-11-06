import { describe, expect, it } from "vitest";
import { ApiFailure, visitErrorMessage } from "../src/lib/api";

describe("403 on a visit", () => {
  it("says what is wrong and who can fix it, with the status and code", () => {
    const m = visitErrorMessage(new ApiFailure(403, "forbidden", "This account does not have access to Notes."), "add visits");
    expect(m).toContain("does not have permission to add visits");
    expect(m).toContain("Ask an admin to give you Notes access");
    expect(m).toContain("HTTP 403 forbidden");
  });
  it("still shows the status when the server sent no code", () => {
    expect(visitErrorMessage(new ApiFailure(403, null))).toContain("(HTTP 403)");
  });
});
