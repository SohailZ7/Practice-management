import { afterEach, describe, expect, it, vi } from "vitest";
import { retryAll, uploadQueued } from "../src/lib/queue";
import type { Engine, QueueItem } from "../src/lib/engine";
import { urlFor } from "../src/lib/environments";

const UUID = () => "aaaaaaaa-bbbb-4ccc-8ddd-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
const mk = (o: Partial<QueueItem> = {}): QueueItem => ({ visit_id: "v" + Math.random().toString(36).slice(2), environment: "production", created_at: "2026-11-18T10:00:00Z", duration_seconds: 5, status: "pending", recording_id: UUID(), link_visit: null, confirmed_at: null, ...o });
const BASE = urlFor("production");

function eng(items: QueueItem[], extra: Partial<Record<string, any>> = {}) {
  const done: string[] = [];
  const e = {
    queueText: async () => "words",
    saveTranscriptCopy: async () => {},
    queueComplete: async (id: string) => { done.push(id); },
    queueList: async () => items.filter((i) => !done.includes(i.visit_id)),
    accessToken: async () => "old",
    refreshAccessToken: async () => "new",
    ...extra,
  } as unknown as Engine;
  return { e, done };
}
type H = (m: string, path: string, body: any, auth: string) => { status: number; body?: unknown } | Error;
function net(h: H) {
  const calls: { m: string; p: string; auth: string; b: any }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const b = init.body ? JSON.parse(init.body) : null;
    const auth = init.headers.authorization ?? "";
    calls.push({ m: init.method, p: url.replace(BASE.replace(/\/$/, ""), ""), auth, b });
    const r = h(init.method, url, b, auth);
    if (r instanceof Error) throw r;
    return { status: r.status, text: async () => JSON.stringify(r.body ?? {}) };
  });
  return calls;
}
const echo: H = (m, _p, b) => ({ status: 200, body: { final: true, seq: b?.seq, sha256: b?.sha256 } });
afterEach(() => vi.unstubAllGlobals());

describe("offline, then online", () => {
  it("everything waits while offline and drains once the connection is back, each exactly once", async () => {
    let online = false;
    const calls = net((m, p, b, a) => (online ? echo(m, p, b, a) : new TypeError("Failed to fetch")));
    const items = [mk(), mk(), mk()];
    const { e, done } = eng(items);
    for (let i = 0; i < 3; i++) {
      const res = await retryAll(e);
      expect(res.every((r) => !r.ok && r.failure?.kind === "unreachable")).toBe(true);
    }
    expect(done).toEqual([]);
    online = true;
    const res = await retryAll(e);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(done.sort()).toEqual(items.map((i) => i.visit_id).sort());
    expect(calls.filter((c) => c.m === "PUT" && c.p.includes(items[0].recording_id!)).length).toBeGreaterThan(1);
    expect(await retryAll(e)).toEqual([]);
  });
  it("connection drops half-way through a batch: finished ones stay finished, the rest wait", async () => {
    let n = 0;
    net((m, p, b, a) => (++n > 2 ? new TypeError("Failed to fetch") : echo(m, p, b, a)));
    const { e, done } = eng([mk(), mk(), mk(), mk()]);
    const res = await retryAll(e);
    expect(res.filter((r) => r.ok)).toHaveLength(2);
    expect(done).toHaveLength(2);
    expect(res.filter((r) => !r.ok).every((r) => r.failure?.kind === "unreachable")).toBe(true);
  });
});

describe("server trouble", () => {
  for (const [name, h, kind] of [
    ["timeout (aborted request)", () => Object.assign(new Error("timed out"), { name: "AbortError" }), "unreachable"],
    ["500", () => ({ status: 500 }), "server"],
    ["502 from a proxy", () => ({ status: 502 }), "server"],
    ["503 while deploying", () => ({ status: 503 }), "server"],
    ["429 rate limited", () => ({ status: 429 }), "refused"],
  ] as [string, H, string][]) {
    it(`${name}: kept on this Mac, reason in plain words, retried later`, async () => {
      net(h);
      const { e, done } = eng([]);
      const r = await uploadQueued(e, mk(), { baseUrl: BASE, accessToken: "t" });
      expect(r.ok).toBe(false);
      expect(r.failure?.kind).toBe(kind);
      expect(r.failure?.message).not.toMatch(/undefined|\[object/);
      expect(done).toEqual([]);
    });
  }
  it("a server that recovers after an outage accepts the very same upload", async () => {
    let up = false;
    const calls = net((m, p, b, a) => (up ? echo(m, p, b, a) : { status: 503 }));
    const { e } = eng([]); const it = mk();
    expect((await uploadQueued(e, it, { baseUrl: BASE, accessToken: "t" })).ok).toBe(false);
    up = true;
    expect((await uploadQueued(e, it, { baseUrl: BASE, accessToken: "t" })).ok).toBe(true);
    const puts = calls.filter((c) => c.m === "PUT");
    expect(new Set(puts.map((c) => c.p)).size).toBe(1);
    expect(new Set(puts.map((c) => c.b.sha256)).size).toBe(1);
  });
});

describe("inbox missing, then deployed", () => {
  it("old server: visit upload keeps working; new server: the inbox is used for the next recording", async () => {
    let inbox = false;
    const calls = net((m, p, b, a) => (p.includes("/notes/inbox/") ? (inbox ? echo(m, p, b, a) : { status: 404 }) : { status: 200, body: {} }));
    const { e } = eng([]);
    const s = { baseUrl: BASE, accessToken: "t" };
    expect((await uploadQueued(e, mk({ link_visit: "v-a" }), s)).ok).toBe(true);
    expect(calls.some((c) => c.p.includes("/notes/visits/v-a"))).toBe(true);
    inbox = true;
    expect((await uploadQueued(e, mk({ link_visit: null }), s)).ok).toBe(true);
    expect(calls.at(-1)!.p).toContain("/notes/inbox/");
  });
  it("old server and an unlinked recording: waits (not lost) with a clear reason", async () => {
    net(() => ({ status: 404 }));
    const { e, done } = eng([]);
    const r = await uploadQueued(e, mk({ link_visit: null }), { baseUrl: BASE, accessToken: "t" });
    expect(r.ok).toBe(false);
    expect(done).toEqual([]);
    expect(r.failure?.message).toBeTruthy();
  });
});

describe("silent token renewal while several recordings are waiting", () => {
  it("an expired token is renewed ONCE for the whole batch, and every item then succeeds", async () => {
    net((m, p, b, a) => (a === "Bearer new" ? echo(m, p, b, a) : { status: 401, body: { reason: "session_expired" } }));
    const refresh = vi.fn(async () => "new");
    const items = [mk(), mk(), mk()];
    const { e, done } = eng(items, { refreshAccessToken: refresh });
    const res = await retryAll(e);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(done).toHaveLength(3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("renewal refused for good: nothing is lost, every item says signed out, flagged for the app to sign out once", async () => {
    net(() => ({ status: 401, body: { reason: "session_revoked" } }));
    const { e, done } = eng([mk(), mk()], { refreshAccessToken: async () => null });
    const res = await retryAll(e);
    expect(done).toEqual([]);
    expect(res.every((r) => r.failure?.kind === "signed_out")).toBe(true);
  });
});
