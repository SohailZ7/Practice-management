import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BULK, isStaging, keyMatches, parsePromote, receiverEnabled, validTarget, whyNotPromotable } from "../src/lib/promote/rules";
import { ruleFor } from "../src/lib/security/rateLimit";

const KEY = "k".repeat(40);

const state = vi.hoisted(() => ({
  promoted: [] as any[],
  tasks: [] as any[],
  feedback: [] as any[],
  users: [{ id: "u1", email: "admin@x.org", role: "ADMIN", active: true, createdAt: 1 }] as any[],
  employees: [{ id: "e1", email: "razak@x.org", active: true }] as any[],
  categories: [] as any[],
  audits: [] as { actorEmail: string; action: string; detail: string }[],
  seq: 0,
}));

vi.mock("../src/lib/db", () => {
  const dbObj: any = {
    promotedItem: {
      findUnique: async ({ where }: any) => state.promoted.find((p) => p.kind === where.kind_sourceId.kind && p.sourceId === where.kind_sourceId.sourceId) ?? null,
      create: async ({ data }: any) => {
        if (state.promoted.some((p) => p.kind === data.kind && p.sourceId === data.sourceId)) throw Object.assign(new Error("dup"), { code: "P2002" });
        state.promoted.push(data);
        return data;
      },
    },
    task: {
      aggregate: async () => ({ _max: { sortOrder: state.tasks.length } }),
      create: async ({ data }: any) => {
        const t = { id: `t${++state.seq}`, ...data };
        state.tasks.push(t);
        return t;
      },
    },
    feedbackItem: {
      create: async ({ data }: any) => {
        const f = { id: `f${++state.seq}`, ...data };
        state.feedback.push(f);
        return f;
      },
    },
    employee: { findUnique: async ({ where }: any) => state.employees.find((e) => e.email === where.email) ?? null },
    category: {
      findUnique: async ({ where }: any) => state.categories.find((c) => c.name === where.name) ?? null,
      create: async ({ data }: any) => {
        const c = { id: `c${++state.seq}`, ...data };
        state.categories.push(c);
        return c;
      },
    },
    user: {
      findUnique: async ({ where }: any) => state.users.find((u) => u.email === where.email) ?? null,
      findFirst: async () => state.users.find((u) => u.role === "ADMIN" && u.active) ?? null,
    },
    auditLog: { create: async ({ data }: any) => state.audits.push(data) },
    // Real transactions roll back; the stand-in snapshots and restores the tables.
    $transaction: async (fn: any) => {
      const snap = JSON.stringify([state.promoted, state.tasks, state.feedback, state.categories]);
      try {
        return await fn(dbObj);
      } catch (e) {
        [state.promoted, state.tasks, state.feedback, state.categories] = JSON.parse(snap).map((a: any) => a);
        throw e;
      }
    },
  };
  return { db: dbObj };
});

import { POST } from "../src/app/api/internal/promote/route";

const task = (over: Record<string, unknown> = {}) => ({ kind: "task", sourceId: "src1", item: { title: "Order paper", notes: "n", dueDate: "2026-11-30", categoryName: "Office", assigneeEmail: "Razak@x.org", ...over } });
const call = (body: unknown, auth: string | null = `Bearer ${KEY}`) =>
  POST(new Request("http://x/api/internal/promote", { method: "POST", headers: auth ? { authorization: auth } : {}, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  for (const k of ["promoted", "tasks", "feedback", "categories", "audits"] as const) (state[k] as any[]).length = 0;
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("PROMOTE_SERVICE_KEY", KEY);
});

describe("environment gating", () => {
  it("staging is only APP_ENV=staging", () => {
    expect(isStaging({ APP_ENV: "staging" })).toBe(true);
    expect(isStaging({ APP_ENV: "production" })).toBe(false);
    expect(isStaging({})).toBe(false);
  });
  it("the receiver needs a non-staging env and a long key", () => {
    expect(receiverEnabled({ APP_ENV: "production", PROMOTE_SERVICE_KEY: KEY })).toBe(true);
    expect(receiverEnabled({ PROMOTE_SERVICE_KEY: KEY })).toBe(true);
    expect(receiverEnabled({ APP_ENV: "staging", PROMOTE_SERVICE_KEY: KEY })).toBe(false);
    expect(receiverEnabled({ APP_ENV: "production" })).toBe(false);
    expect(receiverEnabled({ APP_ENV: "production", PROMOTE_SERVICE_KEY: "short" })).toBe(false);
  });
  it("only https targets (http for localhost)", () => {
    expect(validTarget("https://app.example.org/x")).toBe("https://app.example.org");
    expect(validTarget("http://app.example.org")).toBeNull();
    expect(validTarget("http://localhost:3000")).toBe("http://localhost:3000");
    expect(validTarget("nope")).toBeNull();
    expect(validTarget(undefined)).toBeNull();
  });
  it("is rate limited by ip", () => {
    expect(ruleFor("POST", "/api/internal/promote", false)).toMatchObject({ name: "promote", by: "ip" });
  });
});

describe("keyMatches", () => {
  it("accepts only the exact bearer key", () => {
    expect(keyMatches(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(keyMatches(`Bearer ${KEY}x`, KEY)).toBe(false);
    expect(keyMatches(KEY, KEY)).toBe(false);
    expect(keyMatches(null, KEY)).toBe(false);
    expect(keyMatches("Bearer ", KEY)).toBe(false);
    expect(keyMatches(`Bearer ${KEY}`, undefined)).toBe(false);
  });
});

describe("parsePromote", () => {
  it("accepts a task and normalizes it", () => {
    const r = parsePromote(task());
    expect(r).toMatchObject({ ok: true, value: { kind: "task", item: { title: "Order paper", assigneeEmail: "razak@x.org", completed: false } } });
  });
  it.each([
    [{ ...task(), kind: "patient" }, "invalid_kind"],
    [{ ...task(), sourceId: "a b" }, "invalid_source_id"],
    [{ ...task(), sourceId: "x".repeat(65) }, "invalid_source_id"],
    [task({ title: "" }), "invalid_title"],
    [task({ dueDate: "11/30/2026" }), "invalid_dueDate"],
    [task({ completed: "yes" }), "invalid_completed"],
    [{ kind: "feedback", sourceId: "s", item: { title: "t", kind: "OTHER" } }, "invalid_feedback_kind"],
    [[], "bad_request"],
  ])("rejects bad input %#", (body, error) => {
    expect(parsePromote(body)).toMatchObject({ ok: false, status: 400, error });
  });
  it("refuses test items and patient-looking text", () => {
    expect(parsePromote(task({ isTest: true }))).toMatchObject({ ok: false, status: 422, error: "test_item" });
    expect(parsePromote(task({ notes: "call 425-555-1234" }))).toMatchObject({ ok: false, status: 422, error: "phi_blocked", kinds: ["phone"] });
    expect(parsePromote({ kind: "feedback", sourceId: "s", item: { kind: "BUG", title: "t", description: "MRN 123456" } })).toMatchObject({ ok: false, error: "phi_blocked" });
  });
});

describe("whyNotPromotable", () => {
  const ok = { isTest: false, promotedAt: null };
  it("blocks test, promoted, recurring and synced items", () => {
    expect(whyNotPromotable("task", ok)).toBeNull();
    expect(whyNotPromotable("feedback", { ...ok, isTest: true })).toBe("test_item");
    expect(whyNotPromotable("task", { ...ok, promotedAt: new Date() })).toBe("already_promoted");
    expect(whyNotPromotable("task", { ...ok, recurringId: "r" })).toBe("recurring");
    expect(whyNotPromotable("task", { ...ok, externalSource: "todo" })).toBe("synced");
    expect(MAX_BULK).toBe(50);
  });
});

describe("POST /api/internal/promote", () => {
  it("is 404 on staging and when no key is configured", async () => {
    vi.stubEnv("APP_ENV", "staging");
    expect((await call(task())).status).toBe(404);
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("PROMOTE_SERVICE_KEY", "");
    expect((await call(task())).status).toBe(404);
    expect(state.tasks).toHaveLength(0);
  });
  it("is 401 without the right key, and audits it", async () => {
    expect((await call(task(), null)).status).toBe(401);
    expect((await call(task(), "Bearer wrong")).status).toBe(401);
    expect(state.tasks).toHaveLength(0);
    expect(state.audits.map((a) => a.action)).toEqual(["promote.denied", "promote.denied"]);
  });
  it("creates a task once and returns the same item on a retry", async () => {
    const a = await call(task());
    expect(a.status).toBe(201);
    const first = await a.json();
    expect(first.status).toBe("created");
    const b = await call(task({ title: "changed on retry" }));
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual({ status: "exists", targetId: first.targetId });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ title: "Order paper", assigneeId: "e1", dueDate: "2026-11-30" });
    expect(state.categories).toHaveLength(1);
  });
  it("creates feedback owned by the matching author, else the first admin", async () => {
    const f = (sourceId: string, authorEmail: string) => ({ kind: "feedback", sourceId, item: { kind: "BUG", title: "Broken", description: "d", authorEmail } });
    expect((await call(f("f1", "admin@x.org"))).status).toBe(201);
    expect((await call(f("f2", "nobody@x.org"))).status).toBe(201);
    expect(state.feedback.map((x) => x.authorId)).toEqual(["u1", "u1"]);
    expect(state.feedback[0].source).toBe("promoted");
  });
  it("the same sourceId may exist once per kind", async () => {
    await call(task());
    expect((await call({ kind: "feedback", sourceId: "src1", item: { kind: "FEEDBACK", title: "t" } })).status).toBe(201);
  });
  it("rejects invalid input, test items, oversized and non-JSON bodies", async () => {
    expect((await call("not json")).status).toBe(400);
    expect((await call(task({ title: "" }))).status).toBe(400);
    expect((await call(task({ isTest: true }))).status).toBe(422);
    expect((await call(task({ notes: "x".repeat(70_000) }))).status).toBe(413);
    expect(state.tasks).toHaveLength(0);
  });
  it("audits with ids only, never the text", async () => {
    await call(task({ title: "Secret title text" }));
    expect(state.audits.some((a) => a.action === "promote.receive" && a.detail.includes("src1"))).toBe(true);
    expect(JSON.stringify(state.audits)).not.toContain("Secret title text");
  });
});
