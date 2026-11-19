import { describe, expect, it } from "vitest";
import { SignedOutError, ApiFailure } from "../src/lib/api";
import { describeUploadFailure, endedEnvironments, type UploadResult } from "../src/lib/queue";

const fail = (e: unknown, env: "production" | "staging" = "production"): UploadResult => {
  const failure = describeUploadFailure(e, env);
  return { visitId: "v" + Math.random(), ok: false, reason: failure.message, failure };
};
const okRes: UploadResult = { visitId: "ok", ok: true };

describe("when the server ends a session, every screen agrees (the app signs that environment out once)", () => {
  it("revoked, expired, unknown and inactive sessions are ended; each environment listed once", () => {
    for (const reason of ["session_revoked", "session_expired", "unknown_session", "user_inactive"]) {
      expect(endedEnvironments([fail(new SignedOutError(reason)), fail(new SignedOutError(reason)), okRes])).toEqual(["production"]);
    }
  });
  it("a missing token, a network error, a 500 or a plain 401 never signs anyone out", () => {
    expect(endedEnvironments([fail(new SignedOutError("no_token")), fail(new SignedOutError()), fail(new TypeError("Failed to fetch")), fail(new ApiFailure(500, null)), fail(new ApiFailure(401, null)), okRes])).toEqual([]);
  });
  it("two environments ended at once are both signed out, nothing else", () => {
    expect(endedEnvironments([fail(new SignedOutError("session_expired"), "staging"), fail(new SignedOutError("session_revoked"), "production")]).sort()).toEqual(["production", "staging"]);
  });
  it("a result list with no failures changes nothing", () => {
    expect(endedEnvironments([okRes, okRes])).toEqual([]);
    expect(endedEnvironments([])).toEqual([]);
  });
});
