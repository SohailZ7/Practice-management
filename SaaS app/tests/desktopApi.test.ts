import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { verifyGoogleIdToken } from "../src/lib/desktop/googleId";
import { canRecord, programOf } from "../src/lib/desktop/policy";
import { ruleFor } from "../src/lib/security/rateLimit";
import { hashRefreshToken, newRefreshToken, sessionExpiry, verifyAccessToken } from "../src/lib/desktop/tokens";

const AUD = "desktop-client.apps.example";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const mint = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string | number } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? "https://accounts.google.com")
      .setAudience(opts.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(privateKey);
  return { keys, mint };
}

describe("verifyGoogleIdToken (API-2)", () => {
  it("accepts a valid token and lower-cases the email", async () => {
    const { keys, mint } = await setup();
    const t = await mint({ email: "Dr.Test@Example.com", email_verified: true, name: "Dr Test" });
    expect(await verifyGoogleIdToken(t, AUD, keys)).toEqual({ email: "dr.test@example.com", name: "Dr Test" });
  });
  it("rejects an unverified email", async () => {
    const { keys, mint } = await setup();
    expect(await verifyGoogleIdToken(await mint({ email: "a@b.co", email_verified: false }), AUD, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await mint({ email: "a@b.co" }), AUD, keys)).toBeNull();
  });
  it("rejects the wrong audience, issuer or an expired token", async () => {
    const { keys, mint } = await setup();
    const claims = { email: "a@b.co", email_verified: true };
    expect(await verifyGoogleIdToken(await mint(claims, { aud: "someone-else" }), AUD, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await mint(claims, { iss: "https://evil.example" }), AUD, keys)).toBeNull();
    expect(await verifyGoogleIdToken(await mint(claims, { exp: Math.floor(Date.now() / 1000) - 60 }), AUD, keys)).toBeNull();
  });
  it("rejects a token signed by another key, garbage, and a missing audience", async () => {
    const a = await setup();
    const b = await setup();
    const t = await b.mint({ email: "a@b.co", email_verified: true });
    expect(await verifyGoogleIdToken(t, AUD, a.keys)).toBeNull();
    expect(await verifyGoogleIdToken("not.a.jwt", AUD, a.keys)).toBeNull();
    expect(await verifyGoogleIdToken(await a.mint({ email: "a@b.co", email_verified: true }), "", a.keys)).toBeNull();
  });
});

describe("canRecord (desktop spec ACC-3)", () => {
  const user = (role: string, level: string, active = true) => ({ role, active, access: [{ module: "schedule", level }] });
  it("allows schedule editors and admins", () => {
    expect(canRecord(user("STAFF", "edit"))).toBe(true);
    expect(canRecord(user("ADMIN", "none"))).toBe(true);
  });
  it("allows a provider with view access, not other roles", () => {
    expect(canRecord(user("PROVIDER", "view"))).toBe(true);
    expect(canRecord(user("STAFF", "view"))).toBe(false);
    expect(canRecord(user("PROVIDER", "none"))).toBe(false);
  });
  it("refuses an inactive user", () => {
    expect(canRecord(user("ADMIN", "edit", false))).toBe(false);
  });
});

describe("programOf", () => {
  it("uses the track for track rows and Psych Eval otherwise", () => {
    expect(programOf({ section: "TRACK", trackName: "Track 1 IOP", timeLabel: "x" })).toBe("Track 1 IOP");
    expect(programOf({ section: "TRACK", trackName: "", timeLabel: "AM 2 IOP" })).toBe("AM 2 IOP");
    expect(programOf({ section: "PSYCH_EVAL", trackName: "", timeLabel: "9:00" })).toBe("Psych Eval");
  });
});

describe("rate limits for the Desktop API (API-1)", () => {
  it("limits sign-in more tightly than other calls", () => {
    expect(ruleFor("POST", "/api/desktop/v1/auth/token", false)?.name).toBe("desktop-auth");
    expect(ruleFor("POST", "/api/desktop/v1/auth/refresh", false)?.limit).toBe(20);
    expect(ruleFor("GET", "/api/desktop/v1/schedule", false)?.name).toBe("desktop");
  });
});

describe("pairing tokens (connecting a recorder)", () => {
  it("a pairing token is a long random string, stored only as a hash", () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a.token.length).toBeGreaterThan(30);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashRefreshToken(a.token));
    // The stored hash must not reveal the token.
    expect(a.hash).not.toContain(a.token.slice(0, 12));
  });
  it("a pairing token is not a signed access token, so it is looked up rather than verified", () => {
    const { token } = newRefreshToken();
    expect(verifyAccessToken(token, "secret")).toBeNull();
  });
  it("lasts long enough to be useful but still expires", () => {
    const now = Date.now();
    const days = (sessionExpiry(now).getTime() - now) / 86_400_000;
    expect(days).toBeGreaterThan(7);
    expect(days).toBeLessThan(400);
  });
});
