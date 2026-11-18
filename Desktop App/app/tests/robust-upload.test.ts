import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex, SignedOutError, type Session } from "../src/lib/api";
import { nextDelay } from "../src/lib/backoff";
import { tokenExpiry, shouldRefresh } from "../src/lib/tokenKeeper";
import { retryAll, uploadQueued } from "../src/lib/queue";
import type { Engine, QueueItem } from "../src/lib/engine";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BASE = "https://app.brainandbehaviorcenter.com";
const mk = (o: Partial<QueueItem> = {}): QueueItem => ({ visit_id: "v" + Math.random().toString(36).slice(2), environment: "production", created_at: "2026-11-18T10:00:00Z", duration_seconds: 5, status: "pending", recording_id: UUID, link_visit: null, confirmed_at: null, ...o });
const session = (): Session => ({ baseUrl: BASE, accessToken: "t" });

function engine(text: string, items: QueueItem[] = []) {
  const log: string[] = [];
  const e = {
    queueText: vi.fn(async () => text),
    saveTranscriptCopy: vi.fn(async () => { log.push("copy"); }),
    queueComplete: vi.fn(async () => { log.push("complete"); }),
    queueList: vi.fn(async () => items),
  } as unknown as Engine;
  return { e, log };
}
type R = { status: number; body?: unknown; raw?: string };
function net(h: (m: string, p: string, b: any) => R) {
  const calls: { m: string; p: string; b: any }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const b = init.body ? JSON.parse(init.body) : null;
    calls.push({ m: init.method, p: url.replace(BASE, ""), b });
    const r = h(init.method, url, b);
    return { status: r.status, text: async () => r.raw ?? JSON.stringify(r.body ?? {}) };
  });
  return calls;
}
const ok = (_m: string, _p: string, b: any): R => ({ status: 200, body: { final: true, seq: b?.seq, sha256: b?.sha256 } });
afterEach(() => vi.unstubAllGlobals());

describe("the local copy is only released after the server confirms", () => {
  it("success: text copy saved first, then the queue copy marked complete", async () => {
    net(ok); const { e, log } = engine("note text");
    const r = await uploadQueued(e, mk(), session());
    expect(r.ok).toBe(true);
    expect(log).toEqual(["copy", "complete"]);
  });
  for (const [name, h] of [
    ["server error 500", () => ({ status: 500 })],
    ["server unavailable 503", () => ({ status: 503 })],
    ["payload too large 413", () => ({ status: 413, body: { error: "too_large" } })],
    ["checksum mismatch 422", () => ({ status: 422, body: { error: "checksum_mismatch" } })],
    ["seq conflict 409", () => ({ status: 409, body: { error: "seq_conflict" } })],
    ["unreadable reply", () => ({ status: 200, raw: "<html>proxy error</html>" })],
    ["wrong checksum echoed", (_m: string, _p: string, b: any) => ({ status: 200, body: { final: true, seq: b?.seq, sha256: "f".repeat(64) } })],
    ["final flag missing", (_m: string, _p: string, b: any) => ({ status: 200, body: { final: false, seq: b?.seq, sha256: b?.sha256 } })],
    ["empty reply body", () => ({ status: 200, body: {} })],
  ] as [string, (m: string, p: string, b: any) => R][]) {
    it(`${name}: keeps the saved copy and reports a failure`, async () => {
      net(h); const { e, log } = engine("note text");
      const r = await uploadQueued(e, mk(), session());
      expect(r.ok).toBe(false);
      expect(r.failure).toBeDefined();
      expect(log).toEqual([]);
      expect(e.queueComplete).not.toHaveBeenCalled();
    });
  }
  it("offline: keeps the copy", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    const { e } = engine("x");
    const r = await uploadQueued(e, mk(), session());
    expect(r.failure?.kind).toBe("unreachable");
    expect(e.queueComplete).not.toHaveBeenCalled();
  });
  it("a local read failure never touches the network and keeps the copy", async () => {
    const calls = net(ok); const { e } = engine("x");
    (e.queueText as any).mockRejectedValueOnce(new Error("bad key"));
    const r = await uploadQueued(e, mk(), session());
    expect(r.failure?.kind).toBe("local");
    expect(calls).toHaveLength(0);
    expect(e.queueComplete).not.toHaveBeenCalled();
  });
  it("two simultaneous attempts on one item send once", async () => {
    const calls = net(ok); const { e } = engine("x"); const it = mk();
    const [a, b] = await Promise.all([uploadQueued(e, it, session()), uploadQueued(e, it, session())]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c.m === "PUT")).toHaveLength(1);
    expect(e.queueComplete).toHaveBeenCalledTimes(1);
  });
  it("an already-confirmed item makes no request", async () => {
    const calls = net(ok); const { e } = engine("x");
    await uploadQueued(e, mk({ status: "uploaded" }), session());
    expect(calls).toHaveLength(0);
  });
  it("a failure then a retry succeeds without a duplicate: same uuid and checksum both times", async () => {
    let n = 0; const calls = net((m, p, b) => (++n === 1 ? { status: 503 } : ok(m, p, b)));
    const { e } = engine("same text"); const it = mk();
    expect((await uploadQueued(e, it, session())).ok).toBe(false);
    expect((await uploadQueued(e, it, session())).ok).toBe(true);
    const puts = calls.filter((c) => c.m === "PUT");
    expect(puts[0].p).toBe(puts[1].p);
    expect(puts[0].b.sha256).toBe(puts[1].b.sha256);
    expect(puts[1].b.sha256).toBe(await sha256Hex("same text"));
  });
  it("the checksum covers non-ASCII text exactly", async () => {
    const calls = net(ok); const t = "Patient said “I’m fine” — señor 日本語 😀";
    await uploadQueued(engine(t).e, mk(), session());
    expect(calls[0].b.sha256).toBe(await sha256Hex(t));
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("a huge transcript (2 MB) still sends in one confirmed request", async () => {
    const calls = net(ok); const big = "word ".repeat(400_000);
    expect((await uploadQueued(engine(big).e, mk(), session())).ok).toBe(true);
    expect(calls[0].b.text.length).toBe(big.length);
  });
});

describe("sign-in problems", () => {
  it("revoked session: flagged as ended by the server, copy kept", async () => {
    net(() => ({ status: 401, body: { error: "unauthorized", reason: "session_revoked" } })); const { e } = engine("x");
    const r = await uploadQueued(e, mk(), session());
    expect(r.failure?.kind).toBe("signed_out");
    expect(r.failure?.serverEnded).toBe(true);
    expect(r.failure?.message).toContain("this session was ended");
    expect(e.queueComplete).not.toHaveBeenCalled();
  });
  it("no_token is not treated as ended by the server (nothing to sign out)", async () => {
    net(() => ({ status: 401, body: { reason: "no_token" } }));
    const r = await uploadQueued(engine("x").e, mk(), session());
    expect(r.failure?.serverEnded).toBeUndefined();
  });
  it("a reason with odd characters is never copied into the message", async () => {
    net(() => ({ status: 401, body: { reason: "Jane Doe <script>" } }));
    const r = await uploadQueued(engine("x").e, mk(), session());
    expect(r.failure?.message).not.toContain("Jane");
  });
  it("renewal returns nothing: signed out, not a crash", async () => {
    net(() => ({ status: 401 }));
    const s: Session = { ...session(), refresh: async () => null };
    expect((await uploadQueued(engine("x").e, mk(), s)).failure?.kind).toBe("signed_out");
  });
  it("renewal throws (network): ends as a failure, copy kept", async () => {
    net(() => ({ status: 401 }));
    const s: Session = { ...session(), refresh: async () => { throw new TypeError("offline"); } };
    const e = engine("x").e;
    expect((await uploadQueued(e, mk(), s)).ok).toBe(false);
    expect(e.queueComplete).not.toHaveBeenCalled();
  });
  it("a 401 on the link step still retries later (never silently dropped)", async () => {
    net((m, p, b) => (p.endsWith("/link") ? { status: 401 } : ok(m, p, b)));
    const e = engine("x").e;
    const r = await uploadQueued(e, mk({ link_visit: "visit-1" }), session());
    expect(r.ok).toBe(false);
    expect(e.queueComplete).not.toHaveBeenCalled();
  });
  it("a failed link step (not 401) leaves it safe in the inbox and completes", async () => {
    net((m, p, b) => (p.endsWith("/link") ? { status: 404, body: { error: "visit_not_found" } } : ok(m, p, b)));
    const r = await uploadQueued(engine("x").e, mk({ link_visit: "gone" }), session());
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("Needs link");
  });
});

describe("retry sweep", () => {
  it("retryAll skips confirmed items; one failure does not stop the others", async () => {
    let n = 0;
    const calls = net((m, p, b) => (m === "PUT" && ++n === 2 ? { status: 500 } : ok(m, p, b)));
    const items = [mk(), mk({ status: "uploaded" }), mk(), mk()];
    const { e } = engine("x", items);
    (e as any).accessToken = async () => "t";
    const res = await retryAll(e);
    expect(res).toHaveLength(3);
    expect(res.filter((r) => r.ok)).toHaveLength(2);
    expect(res.filter((r) => !r.ok)).toHaveLength(1);
    expect(calls.filter((c) => c.m === "PUT")).toHaveLength(3);
    expect(e.queueComplete).toHaveBeenCalledTimes(2);
  });
  it("signed out for an environment: every item keeps its copy and says why", async () => {
    const calls = net(ok);
    const { e } = engine("x", [mk(), mk()]);
    (e as any).accessToken = async () => null;
    const res = await retryAll(e);
    expect(res.every((r) => r.failure?.kind === "signed_out")).toBe(true);
    expect(calls).toHaveLength(0);
    expect(e.queueComplete).not.toHaveBeenCalled();
  });
});

describe("timers and tokens never misbehave", () => {
  it("backoff is always a sane finite number", () => {
    for (const a of [NaN, Infinity, -Infinity, -5, 0.7, 1e9]) {
      const d = nextDelay(a as number);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(5000);
      expect(d).toBeLessThanOrEqual(300000);
    }
  });
  it("unreadable tokens never throw", () => {
    for (const t of ["", "a", "a.b", "a.%%%.c", "a." + btoa("not json") + ".c", "a." + btoa('{"exp":"soon"}') + ".c"]) {
      expect(() => tokenExpiry(t)).not.toThrow();
      expect(tokenExpiry(t)).toBeNull();
    }
  });
  it("an already-expired token is renewed", () => {
    const t = "h." + btoa(JSON.stringify({ exp: 100 })) + ".s";
    expect(shouldRefresh(t, 5000, 0, 0)).toBe(true);
  });
  it("SignedOutError keeps the plain message", () => {
    expect(new SignedOutError("session_expired").message).toBe("Signed out. Sign in again in Setup.");
  });
});
