import { describe, expect, it } from "vitest";
import { ApiFailure, SignedOutError } from "../src/lib/api";
import { describeUploadFailure } from "../src/lib/queue";

describe("why a saved transcript has not been sent", () => {
  it("signed out names the environment the transcript is waiting on", () => {
    const f = describeUploadFailure(new SignedOutError(), "production");
    expect(f.kind).toBe("signed_out");
    expect(f.message).toBe("Signed out: sign in again to Production.");
    expect(f.environment).toBe("production");
    expect(describeUploadFailure(new ApiFailure(401, null), "staging").message).toContain("sign in again to Staging");
  });
  it("403 says Notes edit access is missing", () => {
    const f = describeUploadFailure(new ApiFailure(403, "forbidden", "This account does not have access to Notes."), "production");
    expect(f.kind).toBe("no_access");
    expect(f.message).toBe("This account does not have Notes edit access.");
  });
  it("404 says the visit is not in that environment", () => {
    const f = describeUploadFailure(new ApiFailure(404, "not_found"), "production");
    expect(f.kind).toBe("not_found");
    expect(f.message).toBe("This visit is not in the Production app. Add it on the Production website.");
  });
  it("a network error says the practice app cannot be reached", () => {
    expect(describeUploadFailure(new TypeError("Failed to fetch"), "production").message).toBe("Cannot reach the practice app.");
    expect(describeUploadFailure("connection refused", "production").kind).toBe("unreachable");
  });
  it("server and other refusals show the status only", () => {
    expect(describeUploadFailure(new ApiFailure(503, null), "production").message).toBe("The practice app had a problem (HTTP 503).");
    expect(describeUploadFailure(new ApiFailure(422, "bad_body"), "production").message).toBe("The practice app refused the transcript (HTTP 422 bad_body).");
  });
  it("never copies free text from the error (no patient names or transcript)", () => {
    const f = describeUploadFailure(new ApiFailure(422, "Jane Doe said hello", "Jane Doe said hello"), "production");
    expect(f.message).not.toContain("Jane");
    expect(describeUploadFailure(new Error("Jane Doe"), "production").message).not.toContain("Jane");
  });
});
