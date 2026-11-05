import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchVisits, SignedOutError, type Session } from "../src/lib/api";
import { ENVIRONMENTS, isSafeBaseUrl, urlFor } from "../src/lib/environments";
import { uploadQueued } from "../src/lib/queue";
import type { Engine, QueueItem } from "../src/lib/engine";

afterEach(() => vi.unstubAllGlobals());

describe("environments", () => {
  it("has the three built-in addresses and they are all allowed", () => {
    expect(ENVIRONMENTS.map((e) => e.id)).toEqual(["production", "staging", "localhost"]);
    expect(ENVIRONMENTS.every((e) => isSafeBaseUrl(e.url))).toBe(true);
    expect(urlFor("staging")).toContain("321509350517");
  });

  it("refuses plain http except to this Mac", () => {
    expect(isSafeBaseUrl("http://127.0.0.1:3000")).toBe(true);
    for (const bad of ["http://example.com", "http://localhost.evil.com", "http://user@localhost", "ftp://x", "nonsense"]) {
      expect(isSafeBaseUrl(bad)).toBe(false);
    }
  });

  it("will not call a non-https server", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("should not be called"); });
    await expect(fetchVisits({ baseUrl: "http://example.com", accessToken: "t" }, "2026-11-01")).rejects.toThrow(/https/);
  });
});

describe("token refresh", () => {
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

  it("retries once with the new token after a 401", async () => {
    const auths: string[] = [];
    vi.stubGlobal("fetch", (_u: string, i: RequestInit) => {
      const a = (i.headers as Record<string, string>).authorization;
      auths.push(a);
      return Promise.resolve(a === "Bearer new" ? ok({ date: "d", visits: [] }) : new Response("", { status: 401 }));
    });
    const s: Session = { baseUrl: "https://x.test", accessToken: "old", refresh: async () => "new" };
    await fetchVisits(s, "d");
    expect(auths).toEqual(["Bearer old", "Bearer new"]);
  });

  it("signs out when the refresh fails, and does not loop", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", () => (calls++, Promise.resolve(new Response("", { status: 401 }))));
    const s: Session = { baseUrl: "https://x.test", accessToken: "old", refresh: async () => null };
    await expect(fetchVisits(s, "d")).rejects.toBeInstanceOf(SignedOutError);
    expect(calls).toBe(1);
    const s2: Session = { baseUrl: "https://x.test", accessToken: "old", refresh: async () => "still-bad" };
    await expect(fetchVisits(s2, "d")).rejects.toBeInstanceOf(SignedOutError);
    expect(calls).toBe(3);
  });
});

describe("the transcript queue", () => {
  const item: QueueItem = { visit_id: "v1", environment: "staging", created_at: "", duration_seconds: 1, status: "pending" };
  const engine = (done: string[]) =>
    ({
      accessToken: async () => "tok",
      refreshAccessToken: async () => null,
      queueText: async () => "text",
      queueComplete: async (id: string) => { done.push(id); },
    }) as unknown as Engine;

  it("uploads to the environment recorded with it and clears it only on success", async () => {
    const done: string[] = [];
    const urls: string[] = [];
    vi.stubGlobal("fetch", (u: string) => (urls.push(u), Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))));
    expect((await uploadQueued(engine(done), item)).ok).toBe(true);
    expect(urls[0]).toContain("321509350517");
    expect(done).toEqual(["v1"]);
  });

  it("keeps it when the server does not confirm", async () => {
    const done: string[] = [];
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 500 })));
    expect((await uploadQueued(engine(done), { ...item, visit_id: "v2" })).ok).toBe(false);
    expect(done).toEqual([]);
  });
});
