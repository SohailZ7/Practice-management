import { describe, expect, it } from "vitest";
import { buildCsp, makeNonce } from "../src/lib/security/csp";
import { clientIp, createLimiter, ruleFor } from "../src/lib/security/rateLimit";
import { isSameOrigin } from "../src/lib/security/origin";
import { logError } from "../src/lib/safeLog";
import { vi } from "vitest";

describe("buildCsp", () => {
  const csp = buildCsp("abc123");
  it("allows only our own origin and the nonce for scripts", () => {
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
  it("contains no third-party origin", () => {
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toMatch(/\*/);
  });
  it("blocks framing, plugins, base tag and foreign form posts", () => {
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-src 'none'"]) {
      expect(csp).toContain(d);
    }
  });
  it("upgrades insecure requests in production only, and relaxes eval for dev only", () => {
    expect(csp).toContain("upgrade-insecure-requests");
    const dev = buildCsp("n", true);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
  it("makes distinct base64 nonces", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a.length).toBeGreaterThanOrEqual(22);
    expect(makeNonce()).not.toBe(a);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit then refuses, with Retry-After", () => {
    const l = createLimiter({ limit: 3, windowMs: 60_000 });
    const t = 1_000_000;
    expect([1, 2, 3].map(() => l.hit("k", t).allowed)).toEqual([true, true, true]);
    const blocked = l.hit("k", t + 10_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(50);
  });
  it("starts a new window after it elapses", () => {
    const l = createLimiter({ limit: 1, windowMs: 1000 });
    l.hit("k", 0);
    expect(l.hit("k", 999).allowed).toBe(false);
    expect(l.hit("k", 1000).allowed).toBe(true);
  });
  it("keeps keys separate", () => {
    const l = createLimiter({ limit: 1, windowMs: 1000 });
    expect(l.hit("a", 0).allowed).toBe(true);
    expect(l.hit("b", 0).allowed).toBe(true);
    expect(l.hit("a", 1).allowed).toBe(false);
  });
  it("resets if the clock moves backwards", () => {
    const l = createLimiter({ limit: 1, windowMs: 1000 });
    l.hit("a", 5000);
    l.hit("a", 5001);
    expect(l.hit("a", 100).allowed).toBe(true);
  });
  it("does not grow without bound", () => {
    const l = createLimiter({ limit: 1, windowMs: 1000, maxKeys: 10 });
    for (let i = 0; i < 100; i++) l.hit(`k${i}`, 0);
    expect(l.size()).toBeLessThanOrEqual(10);
  });
});

describe("clientIp / ruleFor", () => {
  it("takes the address the platform appended, not what the client claimed", () => {
    expect(clientIp("1.1.1.1, 2.2.2.2, 3.3.3.3", 1)).toBe("3.3.3.3");
    expect(clientIp("6.6.6.6", 1)).toBe("6.6.6.6");
    expect(clientIp("1.1.1.1, 2.2.2.2, 3.3.3.3", 2)).toBe("2.2.2.2");
    expect(clientIp(null)).toBe("unknown");
  });
  it("limits sign-in, import, export, keep-alive and server actions", () => {
    expect(ruleFor("GET", "/api/auth/callback/google", false)?.name).toBe("signin");
    expect(ruleFor("POST", "/api/auth/signin/google", false)?.name).toBe("signin");
    expect(ruleFor("POST", "/api/schedule/import/preview", false)).toMatchObject({ name: "import", by: "user" });
    expect(ruleFor("GET", "/ledger/export", false)?.name).toBe("export");
    expect(ruleFor("POST", "/api/session/touch", false)?.name).toBe("touch");
    expect(ruleFor("POST", "/billing", true)?.name).toBe("action");
    expect(ruleFor("GET", "/schedule", false)).toBeNull();
    expect(ruleFor("POST", "/tasks", false)).toBeNull();
  });
});

describe("isSameOrigin (CSRF)", () => {
  const base = { method: "POST", host: "app.example.com", origin: null as string | null };
  it("accepts GET without checks", () => {
    expect(isSameOrigin({ ...base, method: "GET", origin: "https://evil.test" })).toBe(true);
  });
  it("accepts our own origin and refuses others", () => {
    expect(isSameOrigin({ ...base, origin: "https://app.example.com" })).toBe(true);
    expect(isSameOrigin({ ...base, origin: "https://evil.test" })).toBe(false);
    expect(isSameOrigin({ ...base, origin: "https://app.example.com.evil.test" })).toBe(false);
    expect(isSameOrigin({ ...base, origin: "null" })).toBe(false);
    expect(isSameOrigin({ ...base, origin: "not a url" })).toBe(false);
  });
  it("honours a proxy's forwarded host and the configured URL", () => {
    expect(isSameOrigin({ ...base, host: "localhost:8080", forwardedHost: "app.example.com", origin: "https://app.example.com" })).toBe(true);
    expect(isSameOrigin({ ...base, host: "internal", origin: "https://app.example.com", allowedOrigin: "https://app.example.com" })).toBe(true);
  });
  it("without an Origin header only same-origin Fetch Metadata passes", () => {
    expect(isSameOrigin({ ...base, secFetchSite: "same-origin" })).toBe(true);
    expect(isSameOrigin({ ...base, secFetchSite: "cross-site" })).toBe(false);
    expect(isSameOrigin({ ...base })).toBe(false);
  });
});

describe("logError", () => {
  it("logs the class and code, never the message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("Unique constraint failed on clientInfo = 'ZZ Test, Patient'"), { code: "P2002" });
    logError("something failed", err);
    expect(spy).toHaveBeenCalledWith("something failed: Error (P2002)");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("ZZ Test");
    spy.mockRestore();
  });
});

describe("next.config security headers", () => {
  it("sets the static headers on every route", async () => {
    // @ts-expect-error plain JS module without types
    const mod = await import("../next.config.mjs");
    const rules = await mod.default.headers!();
    const map = Object.fromEntries(rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(rules[0].source).toBe("/:path*");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["X-Frame-Options"]).toBe("DENY");
    expect(map["Referrer-Policy"]).toBe("no-referrer");
    expect(map["Permissions-Policy"]).toContain("camera=()");
    expect(map["Permissions-Policy"]).toContain("geolocation=()");
    expect(mod.default.poweredByHeader).toBe(false);
  });
});
