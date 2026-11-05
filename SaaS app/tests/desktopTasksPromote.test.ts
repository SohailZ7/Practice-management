import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashRefreshToken } from "../src/lib/desktop/tokens";

const state = vi.hoisted(() => ({ users: [] as any[], employees: [] as any[], tasks: [] as any[], feedback: [] as any[], sessions: [] as any[], viewers: [] as any[], audits: [] as any[], seq: 0 }));

vi.mock("../src/lib/db", () => {
  const match = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === "object" && "in" in v) return v.in.includes(row[k]);
      if (v && typeof v === "object" && ("lt" in v || "not" in v)) return (v.lt === undefined || row[k] < v.lt) && (v.not === undefined || row[k] !== v.not);
      return row[k] === v;
    });
  const find = (rows: () => any[]) => ({
    findUnique: async ({ where }: any) => rows().find((x) => Object.entries(where).every(([k, v]) => x[k] === v)) ?? null,
    findMany: async ({ where, take }: any = {}) => rows().filter((r) => match(r, where)).slice(0, take ?? 1e9),
  });
  return {
    db: {
      desktopSession: { ...find(() => state.sessions), update: async () => ({}) },
      user: { ...find(() => state.users) },
      employee: find(() => state.employees),
      category: { findUnique: async () => null, findMany: async () => [] },
      taskViewer: { findMany: async ({ where }: any) => state.viewers.filter((v) => v.userId === where.userId) },
      taskMove: { create: async () => ({}) },
      task: {
        findUnique: async ({ where }: any) => {
          const t = state.tasks.find((x) => x.id === where.id);
          return t ? { ...t, assignee: state.employees.find((e) => e.id === t.assigneeId) ?? null } : null;
        },
        findMany: async ({ where, take }: any = {}) => state.tasks.filter((r) => match(r, where)).slice(0, take ?? 1e9),
        aggregate: async () => ({ _max: { sortOrder: Math.max(0, ...state.tasks.map((t) => t.sortOrder)) } }),
        create: async ({ data }: any) => {
          const t = { id: `t${++state.seq}`, completed: false, completedAt: null, notes: "", createdAt: new Date("2026-11-05T10:00:00Z"), ...data };
          state.tasks.push(t);
          return t;
        },
        update: async ({ where, data }: any) => Object.assign(state.tasks.find((t) => t.id === where.id), data),
      },
      feedbackItem: {
        findUnique: async ({ where }: any) => {
          const f = state.feedback.find((x) => x.id === where.id);
          return f ? { ...f, author: { email: "a@x.org" } } : null;
        },
        update: async ({ where, data }: any) => Object.assign(state.feedback.find((f) => f.id === where.id), data),
      },
      auditLog: { create: async ({ data }: any) => void state.audits.push(data) },
    },
  };
});

const { POST: promote } = await import("../src/app/api/desktop/v1/feedback/[id]/promote/route");
const tasksRoute = await import("../src/app/api/desktop/v1/tasks/route");
const taskRoute = await import("../src/app/api/desktop/v1/tasks/[id]/route");

const admin = { id: "u1", email: "boss@bbc.test", role: "ADMIN", active: true, access: [] };
const amy = { id: "u2", email: "amy@bbc.test", role: "STAFF", active: true, access: [{ module: "tasks", level: "edit" }] };
const vic = { id: "u3", email: "vic@bbc.test", role: "STAFF", active: true, access: [{ module: "tasks", level: "view" }] };
const nob = { id: "u4", email: "nob@bbc.test", role: "STAFF", active: true, access: [] };
const tok = (u: any) => `pair-${u.id}`;
const call = (h: any, url: string, who: any, method = "GET", body?: unknown) =>
  h(new Request(`http://x${url}`, { method, headers: who ? { authorization: `Bearer ${tok(who)}`, "content-type": "application/json" } : {}, body: body === undefined ? undefined : JSON.stringify(body) }));
const task = (id: string, assigneeId: string | null, over: any = {}) => ({ id, title: `T ${id}`, notes: "", assigneeId, categoryId: null, dueDate: null, completed: false, completedAt: null, sortOrder: 1, createdAt: new Date("2026-11-01T00:00:00Z"), ...over });

beforeEach(() => {
  state.seq = 0;
  state.users = [admin, amy, vic, nob].map((u) => ({ ...u }));
  state.sessions = state.users.map((u) => ({ id: `s${u.id}`, userId: u.id, tokenHash: hashRefreshToken(tok(u)), revokedAt: null, expiresAt: new Date(Date.now() + 1e7) }));
  state.employees = [
    { id: "e1", name: "Boss", email: admin.email, active: true, taskTab: true },
    { id: "e2", name: "Amy", email: amy.email, active: true, taskTab: true },
    { id: "e3", name: "Vic", email: vic.email, active: true, taskTab: true },
  ];
  state.viewers = [];
  state.tasks = [task("a", "e1"), task("b", "e2"), task("c", "e2", { completed: true }), task("d", "e3")];
  state.feedback = [
    { id: "f1", kind: "idea", title: "Hi", description: "", isTest: false, promotedAt: null, authorId: "u2" },
    { id: "f2", kind: "idea", title: "Test", description: "", isTest: true, promotedAt: null },
    { id: "f3", kind: "idea", title: "Done", description: "", isTest: false, promotedAt: new Date("2026-11-02T00:00:00Z") },
  ];
  state.audits = [];
  vi.stubEnv("DESKTOP_TOKEN_SECRET", "s".repeat(40));
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("PROMOTE_SERVICE_KEY", "k".repeat(40));
  vi.stubEnv("PROMOTE_TARGET_URL", "https://prod.example.org");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "created", targetId: "p1" }), { status: 201 })));
});

const P = (id: string) => `/api/desktop/v1/feedback/${id}/promote`;

describe("POST /feedback/{id}/promote", () => {
  it("200 promoted with promotedAt, marks the row, audits, calls production once", async () => {
    const r = await call(promote, P("f1"), admin, "POST");
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.promoted).toBe(true);
    expect(Date.parse(b.promotedAt)).not.toBeNaN();
    expect(state.feedback[0].promotedProdId).toBe("p1");
    expect(state.audits.some((a) => a.action === "promote.send")).toBe(true);
    expect((fetch as any).mock.calls.length).toBe(1);
  });
  it("404 when not staging (even unauthenticated), without calling production", async () => {
    vi.stubEnv("APP_ENV", "production");
    expect((await call(promote, P("f1"), admin, "POST")).status).toBe(404);
    expect((await call(promote, P("f1"), null, "POST")).status).toBe(404);
    expect((fetch as any).mock.calls.length).toBe(0);
  });
  it("404 not_found for an unknown id", async () => {
    const r = await call(promote, P("nope"), admin, "POST");
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("not_found");
  });
  it("409 already_promoted and 409 is_test_item, nothing sent", async () => {
    const a = await call(promote, P("f3"), admin, "POST");
    expect([a.status, (await a.json()).error]).toEqual([409, "already_promoted"]);
    const t = await call(promote, P("f2"), admin, "POST");
    expect([t.status, (await t.json()).error]).toEqual([409, "is_test_item"]);
    expect((fetch as any).mock.calls.length).toBe(0);
  });
  it("502 promote_failed when production is unreachable, rejects, or promotion is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await (await call(promote, P("f1"), admin, "POST")).json()).toEqual({ error: "promote_failed" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    expect((await call(promote, P("f1"), admin, "POST")).status).toBe(502);
    vi.stubEnv("PROMOTE_SERVICE_KEY", "");
    expect((await call(promote, P("f1"), admin, "POST")).status).toBe(502);
    expect(state.feedback[0].promotedAt).toBeNull();
  });
  it("401 without a token, 403 for a non-admin (same as the web Promote page)", async () => {
    expect((await call(promote, P("f1"), null, "POST")).status).toBe(401);
    expect((await call(promote, P("f1"), amy, "POST")).status).toBe(403);
    expect((fetch as any).mock.calls.length).toBe(0);
  });
});

describe("GET /tasks", () => {
  const ids = async (who: any, q = "") => ((await (await call(tasksRoute.GET, `/api/desktop/v1/tasks${q}`, who)).json()).tasks as any[]).map((t) => t.id).sort();
  it("defaults to open, with the contract shape", async () => {
    const r = await call(tasksRoute.GET, "/api/desktop/v1/tasks", amy);
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.tasks).toEqual([{ id: "b", title: "T b", dueDate: null, status: "open", createdAt: "2026-11-01T00:00:00.000Z" }]);
  });
  it("status=done and status=all", async () => {
    expect(await ids(amy, "?status=done")).toEqual(["c"]);
    expect(await ids(amy, "?status=all")).toEqual(["b", "c"]);
  });
  it("400 for a bad status", async () => {
    expect((await call(tasksRoute.GET, "/api/desktop/v1/tasks?status=bogus", amy)).status).toBe(400);
  });
  it("scoping: own tasks only; granted employees add theirs; admin sees all; no tasks access is 403; no token 401", async () => {
    expect(await ids(amy, "?status=all")).toEqual(["b", "c"]);
    state.viewers = [{ userId: "u2", employeeId: "e3", level: "view" }];
    expect(await ids(amy, "?status=all")).toEqual(["b", "c", "d"]);
    expect(await ids(admin, "?status=all")).toEqual(["a", "b", "c", "d"]);
    expect((await call(tasksRoute.GET, "/api/desktop/v1/tasks", nob)).status).toBe(403);
    expect((await call(tasksRoute.GET, "/api/desktop/v1/tasks", null)).status).toBe(401);
  });
});

describe("POST /tasks", () => {
  it("201 creates for the signed-in user", async () => {
    const r = await call(tasksRoute.POST, "/api/desktop/v1/tasks", amy, "POST", { title: "  Call back  ", dueDate: "2026-12-01" });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ title: "Call back", dueDate: "2026-12-01", status: "open" });
    expect(state.tasks.at(-1)).toMatchObject({ assigneeId: "e2", title: "Call back" });
  });
  it("400 bad_title when empty, blank, missing, or too long", async () => {
    for (const body of [{ title: "" }, { title: "   " }, {}, { title: "x".repeat(301) }, { title: 5 }]) {
      const r = await call(tasksRoute.POST, "/api/desktop/v1/tasks", amy, "POST", body);
      expect([r.status, (await r.json()).error]).toEqual([400, "bad_title"]);
    }
    expect(state.tasks.length).toBe(4);
  });
  it("403 for view-only users", async () => {
    expect((await call(tasksRoute.POST, "/api/desktop/v1/tasks", vic, "POST", { title: "x" })).status).toBe(403);
  });
});

describe("PATCH /tasks/{id}", () => {
  const url = (id: string) => `/api/desktop/v1/tasks/${id}`;
  it("200 updates status, title and dueDate", async () => {
    const r = await call(taskRoute.PATCH, url("b"), amy, "PATCH", { status: "done", title: "New", dueDate: "2026-12-02" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: "b", title: "New", status: "done", dueDate: "2026-12-02" });
    expect(state.tasks[1].completed).toBe(true);
    const back = await call(taskRoute.PATCH, url("b"), amy, "PATCH", { status: "open" });
    expect((await back.json()).status).toBe("open");
  });
  it("404 not_found", async () => {
    const r = await call(taskRoute.PATCH, url("zzz"), amy, "PATCH", { status: "done" });
    expect([r.status, (await r.json()).error]).toEqual([404, "not_found"]);
  });
  it("400 for bad status or title", async () => {
    expect((await (await call(taskRoute.PATCH, url("b"), amy, "PATCH", { status: "x" })).json()).error).toBe("bad_status");
    expect((await (await call(taskRoute.PATCH, url("b"), amy, "PATCH", { title: "" })).json()).error).toBe("bad_title");
  });
  it("scoping: 403 on another employee's task, allowed with an edit grant, 403 with a view-only grant", async () => {
    expect((await call(taskRoute.PATCH, url("d"), amy, "PATCH", { status: "done" })).status).toBe(403);
    state.viewers = [{ userId: "u2", employeeId: "e3", level: "view" }];
    expect((await call(taskRoute.PATCH, url("d"), amy, "PATCH", { status: "done" })).status).toBe(403);
    state.viewers = [{ userId: "u2", employeeId: "e3", level: "edit" }];
    expect((await call(taskRoute.PATCH, url("d"), amy, "PATCH", { status: "done" })).status).toBe(200);
    expect((await call(taskRoute.PATCH, url("a"), admin, "PATCH", { status: "done" })).status).toBe(200);
  });
});
