import { describe, expect, it, vi } from "vitest";
import { corsHeadersFor, promoteCspExtras, stagingPromoteConfig, webPromoteOrigins } from "../src/lib/promote/webConfig";
import { buildCsp } from "../src/lib/security/csp";
import { promoteToProduction, prodDeps, type ProdVisit, type PromoteSource } from "../src/lib/promote/webPromote";

const src: PromoteSource = { date: "2026-11-10", fullName: "Jane Doe", apptTime: "9:00 AM", program: "IOP", appointmentType: "Follow-up", providerName: "Dr A", transcript: " hello " };
const pv = (o: Partial<ProdVisit> = {}): ProdVisit => ({ id: "p1", initials: "DJ", fullName: "Jane Doe", apptTime: "9:00am", program: "IOP", hasTranscript: false, ...o });
const deps = (day: ProdVisit[]) => ({
  listProduction: vi.fn(async () => day),
  createProduction: vi.fn(async () => ({ id: "new1" })),
  pushProduction: vi.fn(async () => ({ ok: true })),
});

describe("web promote settings", () => {
  it("is off by default and only https origins count", () => {
    expect(webPromoteOrigins({})).toEqual([]);
    expect(webPromoteOrigins({ PROMOTE_WEB_ORIGINS: "http://x.test, https://stg.example.com/path , nope" })).toEqual(["https://stg.example.com"]);
    expect(corsHeadersFor("https://stg.example.com", {})).toBeNull();
    const env = { PROMOTE_WEB_ORIGINS: "https://stg.example.com" };
    expect(corsHeadersFor("https://evil.example.com", env)).toBeNull();
    expect(corsHeadersFor(null, env)).toBeNull();
    const h = corsHeadersFor("https://stg.example.com", env)!;
    expect(h["Access-Control-Allow-Origin"]).toBe("https://stg.example.com");
    expect(h["Access-Control-Allow-Headers"]).not.toMatch(/cookie/i);
    expect(h["Access-Control-Allow-Credentials"]).toBeUndefined();
  });
  it("the staging button needs staging plus both settings", () => {
    const e = { APP_ENV: "staging", PROMOTE_PROD_URL: "https://prod.example.com/", GOOGLE_WEB_CLIENT_ID: "abc.apps.googleusercontent.com" };
    expect(stagingPromoteConfig(e)).toEqual({ prodUrl: "https://prod.example.com", clientId: "abc.apps.googleusercontent.com" });
    expect(stagingPromoteConfig({ ...e, APP_ENV: "production" })).toBeNull();
    expect(stagingPromoteConfig({ ...e, GOOGLE_WEB_CLIENT_ID: "" })).toBeNull();
    expect(stagingPromoteConfig({ ...e, PROMOTE_PROD_URL: "http://prod.example.com" })).toBeNull();
  });
  it("the page policy only opens up when configured", () => {
    expect(buildCsp("n")).toContain("frame-src 'none'");
    expect(buildCsp("n")).not.toContain("accounts.google.com");
    const extra = promoteCspExtras({ APP_ENV: "staging", PROMOTE_PROD_URL: "https://prod.example.com", GOOGLE_WEB_CLIENT_ID: "x" });
    const csp = buildCsp("n", false, extra);
    expect(csp).toContain("connect-src 'self' https://prod.example.com https://accounts.google.com");
    expect(csp).toContain("frame-src https://accounts.google.com");
  });
});

describe("promoteToProduction", () => {
  it("creates the visit and uploads the trimmed transcript", async () => {
    const d = deps([]);
    expect(await promoteToProduction(src, d)).toEqual({ ok: true, already: false });
    expect(d.createProduction).toHaveBeenCalledWith("2026-11-10", expect.objectContaining({ patient: "Jane Doe", program: "IOP" }));
    expect(d.pushProduction).toHaveBeenCalledWith("new1", "hello");
  });
  it("never replaces a transcript already in production (idempotent)", async () => {
    const d = deps([pv({ hasTranscript: true })]);
    expect(await promoteToProduction(src, d)).toEqual({ ok: true, already: true });
    expect(d.createProduction).not.toHaveBeenCalled();
    expect(d.pushProduction).not.toHaveBeenCalled();
  });
  it("finishes a visit that is there without its transcript, without creating another", async () => {
    const d = deps([pv()]);
    expect(await promoteToProduction(src, d)).toEqual({ ok: true, already: false });
    expect(d.createProduction).not.toHaveBeenCalled();
    expect(d.pushProduction).toHaveBeenCalledWith("p1", "hello");
  });
  it("stops rather than risk a duplicate when production hides names", async () => {
    const d = deps([pv({ fullName: undefined })]);
    const r = await promoteToProduction(src, d);
    expect(r.ok).toBe(false);
    expect(d.createProduction).not.toHaveBeenCalled();
  });
  it("changes nothing when production is unreachable or the transcript is empty", async () => {
    const d = deps([]);
    d.listProduction.mockRejectedValueOnce(new Error("(503)"));
    expect((await promoteToProduction(src, d)).ok).toBe(false);
    expect(d.createProduction).not.toHaveBeenCalled();
    expect((await promoteToProduction({ ...src, transcript: "  " }, deps([]))).ok).toBe(false);
  });
  it("says to press again when only the upload fails", async () => {
    const d = deps([]);
    d.pushProduction.mockRejectedValueOnce(new Error("(500)"));
    const r = await promoteToProduction(src, d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Press Promote again/);
  });
});

describe("prodDeps", () => {
  it("sends a bearer token to production's Desktop API and reports only status codes", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "forbidden", detail: "Jane Doe" }), { status: 403 }));
    const d = prodDeps("https://prod.example.com", "tok", f as unknown as typeof fetch);
    await expect(d.listProduction("2026-11-10")).rejects.toThrow("(403 forbidden)");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://prod.example.com/api/desktop/v1/notes/visits?date=2026-11-10");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
});

import { preflightProduction } from "../src/lib/promote/webPromote";
describe("preflightProduction", () => {
  const f = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("is ready when production says so, using a plain GET", async () => {
    const m = f(200, { ready: true, clientId: "c1" });
    expect(await preflightProduction("https://p.example.com", "c1", m)).toEqual({ ok: true });
    expect((m as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].method).toBe("GET");
  });
  it("explains each refusal and changes nothing", async () => {
    expect(await preflightProduction("https://p", "c1", f(503))).toMatchObject({ ok: false, message: expect.stringMatching(/not set up/) });
    expect(await preflightProduction("https://p", "c1", f(403))).toMatchObject({ ok: false, message: expect.stringMatching(/does not allow/) });
    expect(await preflightProduction("https://p", "c1", f(200, { clientId: "other" }))).toMatchObject({ ok: false, message: expect.stringMatching(/different/) });
    expect(await preflightProduction("https://p", "c1", f(500))).toMatchObject({ ok: false });
    const down = vi.fn(async () => { throw new Error("x"); }) as unknown as typeof fetch;
    expect(await preflightProduction("https://p", "c1", down)).toMatchObject({ ok: false, message: expect.stringMatching(/Could not reach/) });
  });
  it("lets an older production without the check continue", async () => {
    expect(await preflightProduction("https://p", "c1", f(405))).toEqual({ ok: true });
  });
});
