import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, FINAL_SEQ, SignedOutError, sha256Hex, type Session } from "../src/lib/api";
import { nextDelay } from "../src/lib/backoff";
import { shouldRefresh, tokenExpiry } from "../src/lib/tokenKeeper";
import { sendConfirmed } from "../src/lib/queue";
import type { QueueItem } from "../src/lib/engine";

const UUID = "11111111-2222-4333-8444-555555555555";
const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  visit_id: "v1", environment: "production", created_at: "2026-11-18T10:00:00Z", duration_seconds: 60, status: "pending",
  recording_id: UUID, link_visit: "v1", confirmed_at: null, ...over,
});
const jwt = (exp: number) => `h.${btoa(JSON.stringify({ exp })).replace(/=/g, "")}.s`;
const BASE = "https://app.brainandbehaviorcenter.com";

type Handler = (method: string, path: string, body: any, auth: string) => { status: number; body?: unknown };
function server(h: Handler) {
  const calls: { method: string; path: string; body: any }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const path = url.replace(BASE, "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body });
    const r = h(init.method, path, body, init.headers.authorization ?? "");
    return { status: r.status, text: async () => JSON.stringify(r.body ?? {}) };
  });
  return calls;
}
const session = (refresh?: Session["refresh"]): Session => ({ baseUrl: BASE, accessToken: "old", refresh });
afterEach(() => vi.unstubAllGlobals());

describe("backoff", () => {
  it("doubles from 5 s and stops at 5 minutes", () => {
    expect([0, 1, 2, 3].map(nextDelay)).toEqual([5000, 10000, 20000, 40000]);
    expect(nextDelay(10)).toBe(300000);
    expect(nextDelay(1000)).toBe(300000);
  });
});

describe("silent token renewal", () => {
  it("renews inside the last 15 minutes, not before", () => {
    const now = 1_000_000;
    expect(tokenExpiry(jwt(now + 100))).toBe(now + 100);
    expect(shouldRefresh(jwt(now + 600), now, 0, 0)).toBe(true);
    expect(shouldRefresh(jwt(now + 3600), now, 0, 0)).toBe(false);
  });
  it("unreadable token: renews after 30 minutes", () => {
    expect(shouldRefresh("opaque", 0, 0, 29 * 60_000)).toBe(false);
    expect(shouldRefresh("opaque", 0, 0, 31 * 60_000)).toBe(true);
  });
});

describe("confirmed upload", () => {
  const echo: Handler = (m, p, b) => (m === "PUT" ? { status: 200, body: { seq: b.seq, final: true, sha256: b.sha256 } } : { status: 200, body: { ok: true } });

  it("sends to the inbox by UUID and links the visit", async () => {
    const calls = server(echo);
    const d = await sendConfirmed(session(), item(), "hello");
    expect(d).toEqual({ via: "inbox", linked: true });
    expect(calls[0].path).toBe(`/api/desktop/v1/notes/inbox/${UUID}`);
    expect(calls[0].body.seq).toBe(FINAL_SEQ);
    expect(calls[0].body.sha256).toBe(await sha256Hex("hello"));
    expect(calls[1].path).toContain("/link");
  });
  it("a duplicate retry sends the same uuid and checksum, so the server keeps one copy", async () => {
    const calls = server(echo);
    await sendConfirmed(session(), item(), "same");
    await sendConfirmed(session(), item(), "same");
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0].path).toBe(puts[1].path);
    expect(puts[0].body.sha256).toBe(puts[1].body.sha256);
  });
  it("a checksum the server does not echo is NOT confirmed (the local copy stays)", async () => {
    server((m, p, b) => ({ status: 200, body: { seq: b.seq, final: true, sha256: "0".repeat(64) } }));
    await expect(sendConfirmed(session(), item(), "x")).rejects.toMatchObject({ status: 422, code: "checksum_mismatch" });
  });
  it("offline: the error surfaces so the item is retried later", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    await expect(sendConfirmed(session(), item(), "x")).rejects.toBeInstanceOf(Error);
  });
  it("expired token: refreshes once and then succeeds", async () => {
    const calls = server((m, p, b, auth) => auth === "Bearer new" ? echo(m, p, b, auth) : { status: 401 });
    const refresh = vi.fn(async () => "new");
    await sendConfirmed(session(refresh), item(), "x");
    expect(refresh).toHaveBeenCalledOnce();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2);
  });
  it("refresh failure means signed out", async () => {
    server(() => ({ status: 401 }));
    await expect(sendConfirmed(session(async () => null), item(), "x")).rejects.toBeInstanceOf(SignedOutError);
  });
  it("inbox not deployed yet (404): falls back to the visit upload", async () => {
    const calls = server((m, p) => (p.includes("/inbox/") ? { status: 404 } : { status: 200, body: {} }));
    const d = await sendConfirmed(session(), item(), "x");
    expect(d.via).toBe("visit");
    expect(calls.some((c) => c.path.includes("/notes/visits/v1"))).toBe(true);
  });
  it("an unlinked recording is safe in the inbox without needing any visit", async () => {
    const calls = server(echo);
    const d = await sendConfirmed(session(), item({ link_visit: null }), "x");
    expect(d).toEqual({ via: "inbox", linked: false });
    expect(calls).toHaveLength(1);
  });
  it("a 404 with nowhere to fall back reports inbox_pending", async () => {
    server(() => ({ status: 404 }));
    await expect(sendConfirmed(session(), item({ link_visit: null }), "x")).rejects.toBeInstanceOf(ApiFailure);
  });
});
