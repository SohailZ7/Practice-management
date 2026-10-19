import { describe, expect, it } from "vitest";
import { MAX_SKEW_MS, WARNING_MS, checkSession, sessionPolicy, shouldRefresh } from "../src/lib/sessionExpiry";
import { idleState } from "../src/lib/idleClock";
import { sessionCookieName, useSecureCookies } from "../src/lib/sessionCookie";

const MIN = 60_000;
const HOUR = 60 * MIN;
const policy = { idleMs: 15 * MIN, maxMs: 12 * HOUR };
const T0 = 1_800_000_000_000;

describe("sessionPolicy", () => {
  it("defaults to 15 minutes idle and 12 hours absolute", () => {
    expect(sessionPolicy({})).toEqual({ idleMs: 15 * MIN, maxMs: 12 * HOUR });
  });
  it("reads the environment", () => {
    expect(sessionPolicy({ SESSION_IDLE_MINUTES: "5", SESSION_MAX_HOURS: "8" })).toEqual({ idleMs: 5 * MIN, maxMs: 8 * HOUR });
  });
  it("ignores junk, zero and negative values", () => {
    for (const bad of ["", "abc", "0", "-3", "NaN", "Infinity"]) {
      expect(sessionPolicy({ SESSION_IDLE_MINUTES: bad, SESSION_MAX_HOURS: bad })).toEqual({ idleMs: 15 * MIN, maxMs: 12 * HOUR });
    }
  });
  it("never lets the idle limit exceed the absolute limit", () => {
    expect(sessionPolicy({ SESSION_IDLE_MINUTES: "600", SESSION_MAX_HOURS: "1" }).idleMs).toBe(HOUR);
  });
});

describe("checkSession", () => {
  it("accepts a fresh session and reports the nearer deadline", () => {
    const v = checkSession({ authAt: T0, lastActive: T0 }, T0 + MIN, policy);
    expect(v).toEqual({ ok: true, idleDeadline: T0 + 15 * MIN, absoluteDeadline: T0 + 12 * HOUR, deadline: T0 + 15 * MIN });
  });
  it("expires after the idle limit, exactly at the boundary", () => {
    const s = { authAt: T0, lastActive: T0 };
    expect(checkSession(s, T0 + 15 * MIN - 1, policy).ok).toBe(true);
    expect(checkSession(s, T0 + 15 * MIN, policy)).toEqual({ ok: false, reason: "idle" });
  });
  it("a recent request keeps an old session alive until the absolute limit", () => {
    const s = { authAt: T0, lastActive: T0 + 11 * HOUR + 50 * MIN };
    expect(checkSession(s, T0 + 11 * HOUR + 55 * MIN, policy).ok).toBe(true);
  });
  it("expires at the absolute limit even when the user is active", () => {
    const s = { authAt: T0, lastActive: T0 + 12 * HOUR - 1000 };
    expect(checkSession(s, T0 + 12 * HOUR - 1, policy).ok).toBe(true);
    expect(checkSession(s, T0 + 12 * HOUR, policy)).toEqual({ ok: false, reason: "absolute" });
  });
  it("reports absolute when both limits have passed", () => {
    expect(checkSession({ authAt: T0, lastActive: T0 }, T0 + 13 * HOUR, policy)).toEqual({ ok: false, reason: "absolute" });
  });
  it("caps the deadline at the absolute limit", () => {
    const v = checkSession({ authAt: T0, lastActive: T0 + 12 * HOUR - 2 * MIN }, T0 + 12 * HOUR - MIN, policy);
    expect(v.ok && v.deadline).toBe(T0 + 12 * HOUR);
  });
  it("rejects missing, partial and non-numeric stamps (including tokens from before this feature)", () => {
    expect(checkSession(null, T0, policy)).toEqual({ ok: false, reason: "missing" });
    expect(checkSession({}, T0, policy)).toEqual({ ok: false, reason: "missing" });
    expect(checkSession({ authAt: T0 }, T0, policy)).toEqual({ ok: false, reason: "invalid" });
    for (const bad of ["1", NaN, Infinity, -1, 0, null, {}]) {
      expect(checkSession({ authAt: bad, lastActive: T0 }, T0, policy).ok).toBe(false);
      expect(checkSession({ authAt: T0, lastActive: bad }, T0, policy).ok).toBe(false);
    }
    expect(checkSession({ authAt: T0, lastActive: T0 }, NaN, policy).ok).toBe(false);
  });
  it("tolerates small forward clock skew but not large", () => {
    expect(checkSession({ authAt: T0 + 1000, lastActive: T0 + 1000 }, T0, policy).ok).toBe(true);
    const skewed = checkSession({ authAt: T0, lastActive: T0 + MAX_SKEW_MS }, T0, policy);
    expect(skewed.ok && skewed.idleDeadline).toBe(T0 + 15 * MIN); // idle clock cannot run ahead of now
    expect(checkSession({ authAt: T0, lastActive: T0 + MAX_SKEW_MS + 1 }, T0, policy)).toEqual({ ok: false, reason: "invalid" });
    expect(checkSession({ authAt: T0 + MAX_SKEW_MS + 1, lastActive: T0 }, T0, policy)).toEqual({ ok: false, reason: "invalid" });
  });
  it("a clock that jumps backwards never extends a session past the idle limit from now", () => {
    const v = checkSession({ authAt: T0, lastActive: T0 + 3 * MIN }, T0 + MIN, policy);
    expect(v.ok && v.idleDeadline).toBe(T0 + MIN + 15 * MIN);
  });
  it("honours custom policies", () => {
    const short = { idleMs: MIN, maxMs: 5 * MIN };
    expect(checkSession({ authAt: T0, lastActive: T0 }, T0 + MIN, short)).toEqual({ ok: false, reason: "idle" });
  });
});

describe("shouldRefresh", () => {
  it("only rewrites the cookie when the stamp is at least 30 seconds old", () => {
    expect(shouldRefresh(T0, T0 + 29_999)).toBe(false);
    expect(shouldRefresh(T0, T0 + 30_000)).toBe(true);
  });
  it("rewrites a stamp that is ahead of the clock", () => {
    expect(shouldRefresh(T0 + 1000, T0)).toBe(true);
  });
});

describe("idleState (browser countdown)", () => {
  const base = { idleMs: 15 * MIN, absoluteDeadline: T0 + 12 * HOUR, lastActivity: T0 };
  it("is active until two minutes before logoff", () => {
    expect(idleState({ ...base, now: T0 + 13 * MIN - 1 })).toEqual({ kind: "active" });
  });
  it("warns in the last two minutes", () => {
    expect(idleState({ ...base, now: T0 + 13 * MIN })).toEqual({ kind: "warn", reason: "idle", msLeft: WARNING_MS });
    expect(idleState({ ...base, now: T0 + 14 * MIN })).toEqual({ kind: "warn", reason: "idle", msLeft: MIN });
  });
  it("expires at the deadline", () => {
    expect(idleState({ ...base, now: T0 + 15 * MIN })).toEqual({ kind: "expired", reason: "idle" });
  });
  it("activity moves the deadline", () => {
    expect(idleState({ ...base, lastActivity: T0 + 10 * MIN, now: T0 + 14 * MIN })).toEqual({ kind: "active" });
  });
  it("warns about and enforces the absolute limit", () => {
    const s = { ...base, lastActivity: T0 + 12 * HOUR - MIN };
    expect(idleState({ ...s, now: T0 + 12 * HOUR - 90_000 })).toEqual({ kind: "warn", reason: "absolute", msLeft: 90_000 });
    expect(idleState({ ...s, now: T0 + 12 * HOUR })).toEqual({ kind: "expired", reason: "absolute" });
  });
  it("a laptop waking after hours expires at once", () => {
    expect(idleState({ ...base, now: T0 + 5 * HOUR }).kind).toBe("expired");
  });
});

describe("session cookie settings", () => {
  it("uses the __Secure- prefix only for secure cookies", () => {
    expect(sessionCookieName(true)).toBe("__Secure-next-auth.session-token");
    expect(sessionCookieName(false)).toBe("next-auth.session-token");
  });
  it("is secure over https and in production, but not for http localhost", () => {
    expect(useSecureCookies({ NEXTAUTH_URL: "https://app.example.com", NODE_ENV: "development" })).toBe(true);
    expect(useSecureCookies({ NEXTAUTH_URL: "http://localhost:3100", NODE_ENV: "development" })).toBe(false);
    expect(useSecureCookies({ NEXTAUTH_URL: "http://localhost:3000", NODE_ENV: "production" })).toBe(false);
    expect(useSecureCookies({ NODE_ENV: "production" })).toBe(true);
  });
});
