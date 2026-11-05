import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tasks: [] as any[], audits: [] as any[] }));
vi.mock("../src/lib/db", () => ({
  db: {
    task: {
      findUnique: async ({ where }: any) => state.tasks.find((t) => t.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(state.tasks.find((t) => t.id === where.id), data),
    },
    auditLog: { create: async ({ data }: any) => state.audits.push(data) },
  },
}));
import { promoteItems, PromoteConfigError } from "../src/lib/promote/send";

const mk = (id: string, over: any = {}) => ({ id, title: `T ${id}`, notes: "", dueDate: null, expiresAt: null, completed: false, isTest: false, promotedAt: null, recurringId: null, externalSource: null, assignee: { email: "a@x.org" }, category: null, ...over });
const KEY = "k".repeat(40);

beforeEach(() => {
  state.tasks = [mk("a"), mk("b", { isTest: true }), mk("c", { promotedAt: new Date() }), mk("d", { recurringId: "r" })];
  state.audits = [];
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("PROMOTE_SERVICE_KEY", KEY);
  vi.stubEnv("PROMOTE_TARGET_URL", "https://prod.example.org");
});

describe("promoteItems (staging)", () => {
  it("refuses outside staging or without config, calling nothing", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.stubEnv("APP_ENV", "production");
    await expect(promoteItems("s@x.org", "task", ["a"])).rejects.toBeInstanceOf(PromoteConfigError);
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("PROMOTE_TARGET_URL", "http://prod.example.org");
    await expect(promoteItems("s@x.org", "task", ["a"])).rejects.toBeInstanceOf(PromoteConfigError);
    expect(f).not.toHaveBeenCalled();
  });
  it("sends only promotable items with the key, marks them, and never sends test/promoted/recurring", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: "created", targetId: "p1" }), { status: 201 }));
    vi.stubGlobal("fetch", f);
    const r = await promoteItems("s@x.org", "task", ["a", "b", "c", "d", "a", "zz"]);
    expect(r).toEqual([
      { id: "a", ok: true, status: "created" },
      { id: "b", ok: false, error: "test_item" },
      { id: "c", ok: false, error: "already_promoted" },
      { id: "d", ok: false, error: "recurring" },
      { id: "zz", ok: false, error: "not_found" },
    ]);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://prod.example.org/api/internal/promote");
    expect((init.headers as any).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: "task", sourceId: "a", item: { title: "T a", assigneeEmail: "a@x.org" } });
    expect(state.tasks[0]).toMatchObject({ promotedProdId: "p1" });
    expect(state.tasks[0].promotedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(state.audits)).not.toContain(KEY);
  });
  it("a failed call leaves the item unmarked and reports the reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "phi_blocked" }), { status: 422 })));
    expect(await promoteItems("s@x.org", "task", ["a"])).toEqual([{ id: "a", ok: false, error: "phi_blocked" }]);
    expect(state.tasks[0].promotedAt).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await promoteItems("s@x.org", "task", ["a"])).toEqual([{ id: "a", ok: false, error: "unreachable" }]);
  });
});
