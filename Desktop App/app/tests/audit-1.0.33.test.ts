import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, fetchVisits, type Session } from "../src/lib/api";
import { clearEvents, record, recentEvents, shouldAutoReport, markReported } from "../src/lib/diagnostics";
import { describeUploadFailure, parkedIds, sendConfirmed, PARK_RETRY_MS, type UploadFailure } from "../src/lib/queue";
import type { QueueItem } from "../src/lib/engine";

const BASE = "https://app.brainandbehaviorcenter.com";
const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const mk = (o: Partial<QueueItem> = {}): QueueItem => ({ visit_id: "v1", environment: "production", created_at: "2026-11-18T10:00:00Z", duration_seconds: 5, status: "pending", recording_id: UUID, link_visit: null, confirmed_at: null, ...o });
function net(h: (m: string, p: string) => number) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => { calls.push(`${init.method} ${url.replace(BASE, "")}`); return { status: h(init.method, url), text: async () => "{}" }; });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("a 401 that is renewed silently is not an error report", () => {
  beforeEach(() => clearEvents());
  it("records nothing when the renewal works", async () => {
    let first = true;
    net(() => { if (first) { first = false; return 401; } return 200; });
    const s: Session = { baseUrl: BASE, accessToken: "old", refresh: async () => "new" };
    await fetchVisits(s, "2026-11-19").catch(() => {});
    expect(recentEvents().filter((e) => e.code?.startsWith("401"))).toEqual([]);
  });
  it("records one event when the sign-in really is gone", async () => {
    net(() => 401);
    const s: Session = { baseUrl: BASE, accessToken: "old", refresh: async () => null };
    await fetchVisits(s, "2026-11-19").catch(() => {});
    expect(recentEvents().filter((e) => e.code === "401").length).toBe(1);
  });
});

describe("repeated identical failures are one event, one report", () => {
  beforeEach(() => clearEvents());
  it("collapses identical events and counts them", () => {
    for (let i = 0; i < 40; i++) record({ kind: "api", code: "404", route: "/notes/inbox/:id" }, false);
    const ev = recentEvents();
    expect(ev.length).toBe(1);
    expect(ev[0].detail).toBe("repeated 40 times");
  });
  it("auto-report only when something new happened, else at most every 6 hours", () => {
    record({ kind: "api", code: "404", route: "/notes/inbox/:id" }, false);
    const t0 = 1_000_000;
    expect(shouldAutoReport(t0)).toBe(true);
    markReported(t0);
    expect(shouldAutoReport(t0 + 10 * 60_000)).toBe(false);
    record({ kind: "api", code: "404", route: "/notes/inbox/:id" }, false); // same again
    expect(shouldAutoReport(t0 + 10 * 60_000)).toBe(false);
    expect(shouldAutoReport(t0 + 6 * 3_600_000 + 1)).toBe(true);
    record({ kind: "api", code: "500", route: "/notes/visits" }, false); // something new
    expect(shouldAutoReport(t0 + 11 * 60_000)).toBe(true);
  });
});

describe("a 404 never loops and never loses the recording", () => {
  it("inbox missing and the visit fallback missing too: one inbox_pending failure, two calls", async () => {
    const calls = net(() => 404);
    await expect(sendConfirmed({ baseUrl: BASE, accessToken: "t" }, mk({ link_visit: "visit1" }), "text")).rejects.toMatchObject({ status: 404, code: "inbox_pending" });
    expect(calls.length).toBe(2);
  });
  it("describes it as waiting for the server, not as a missing visit", () => {
    const f = describeUploadFailure(new ApiFailure(404, "inbox_pending"), "production");
    expect(f.kind).toBe("inbox_pending");
    expect(f.message).toMatch(/safe on this Mac/i);
  });
  it("parkedIds: unknown visits stay parked; inbox_pending is retried at most every 30 minutes", () => {
    const base = { environment: "production" as const, message: "x" };
    const now = 10_000_000;
    const failures: Record<string, UploadFailure> = {
      a: { ...base, kind: "not_found", lastTriedAt: now },
      b: { ...base, kind: "inbox_pending", lastTriedAt: now - 5 * 60_000 },
      c: { ...base, kind: "inbox_pending", lastTriedAt: now - PARK_RETRY_MS - 1 },
      d: { ...base, kind: "unreachable", lastTriedAt: now },
    };
    expect([...parkedIds(failures, now)].sort()).toEqual(["a", "b"]);
  });
});
