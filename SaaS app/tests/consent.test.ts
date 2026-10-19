import { describe, expect, it } from "vitest";
import { consentBadge, recordingCheck, validateConsent } from "../src/lib/consent";
import {
  bearerToken,
  desktopSecret,
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "../src/lib/desktop/tokens";

describe("recordingCheck (CON-4, CON-8)", () => {
  it("refuses when the row has no linked patient", () => {
    expect(recordingCheck(null, [{ active: true, consentDate: "2026-10-01" }])).toEqual({ allowed: false, reason: "no_patient" });
  });
  it("refuses without an active consent, even if an old one exists", () => {
    expect(recordingCheck("p1", [])).toEqual({ allowed: false, reason: "no_consent" });
    expect(recordingCheck("p1", [{ active: false, consentDate: "2026-09-01" }])).toEqual({ allowed: false, reason: "no_consent" });
  });
  it("allows with an active consent", () => {
    expect(recordingCheck("p1", [{ active: false, consentDate: "2026-01-01" }, { active: true, consentDate: "2026-10-01" }])).toEqual({ allowed: true });
  });
});

describe("validateConsent (CON-1, CON-6)", () => {
  const today = "2026-10-19";
  it("accepts today and past dates", () => {
    expect(validateConsent({ consentDate: "2026-10-19" }, today).ok).toBe(true);
    expect(validateConsent({ consentDate: "2026-01-02", note: "signed intake form" }, today).ok).toBe(true);
  });
  it("rejects future, malformed and missing dates", () => {
    expect(validateConsent({ consentDate: "2026-10-20" }, today).errors.consentDate).toMatch(/future/);
    expect(validateConsent({ consentDate: "10/19/2026" }, today).errors.consentDate).toBeTruthy();
    expect(validateConsent({ consentDate: "2026-02-30" }, today).errors.consentDate).toBeTruthy();
    expect(validateConsent({}, today).errors.consentDate).toBeTruthy();
  });
  it("flattens control characters and limits the note", () => {
    expect(validateConsent({ consentDate: today, note: "a\nb" }, today).values.note).toBe("a b");
    expect(validateConsent({ consentDate: today, note: "x".repeat(201) }, today).errors.note).toBeTruthy();
  });
});

describe("consentBadge", () => {
  it("is unlinked, none or on_file", () => {
    expect(consentBadge(null, [])).toBe("unlinked");
    expect(consentBadge("p", [])).toBe("none");
    expect(consentBadge("p", [{ active: true, consentDate: "2026-10-01" }])).toBe("on_file");
  });
});

describe("desktop access tokens (API-2)", () => {
  const secret = "test-secret";
  const claims = { uid: "u1", sid: "s1", exp: 2000 };
  it("round-trips valid claims", () => {
    expect(verifyAccessToken(signAccessToken(claims, secret), secret, 1000)).toEqual(claims);
  });
  it("rejects an expired token", () => {
    expect(verifyAccessToken(signAccessToken(claims, secret), secret, 2000)).toBeNull();
  });
  it("rejects a wrong secret and a tampered payload", () => {
    const t = signAccessToken(claims, secret);
    expect(verifyAccessToken(t, "other", 1000)).toBeNull();
    const [v, , sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, uid: "admin" })).toString("base64url");
    expect(verifyAccessToken(`${v}.${forged}.${sig}`, secret, 1000)).toBeNull();
  });
  it("rejects garbage", () => {
    for (const bad of ["", "abc", "v1.a", "v2.a.b", "v1..", "v1.e30.e30"]) expect(verifyAccessToken(bad, secret, 1000)).toBeNull();
  });
});

describe("refresh tokens and helpers", () => {
  it("stores only a hash that matches the token", () => {
    const { token, hash } = newRefreshToken();
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
    expect(newRefreshToken().token).not.toBe(token);
  });
  it("parses the bearer header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
  it("derives the secret, or fails closed", () => {
    expect(desktopSecret({ DESKTOP_TOKEN_SECRET: "own" })).toBe("own");
    expect(desktopSecret({ NEXTAUTH_SECRET: "base" })).not.toBe("base");
    expect(() => desktopSecret({})).toThrow();
  });
});
