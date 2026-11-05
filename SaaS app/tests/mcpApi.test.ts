import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiBearer, clampTtlDays, hashApiToken, newApiToken } from "../src/lib/mcpApi/tokens";
import { PHI_WITHHELD, parseListQuery, parseTaskBody, toTaskOut } from "../src/lib/mcpApi/shape";
import { ruleFor } from "../src/lib/security/rateLimit";

// A tiny in-memory stand-in for Prisma, just the calls the tasks API makes.
const state = vi.hoisted(() => ({
  users: [] as any[],
  employees: [] as any[],
  categories: [] as any[],
  tasks: [] as any[],
  tokens: [] as any[],
  audits: [] as { actorEmail: string; action: string; detail: string }[],
  moves: [] as any[],
  seq: 0,
}));

vi.mock("../src/lib/db", () => {
  const match = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === "object" && "in" in v) return v.in.includes(row[k]);
      if (v && typeof v === "object" && ("lt" in v || "not" in v)) return (v.lt === undefined || row[k] < v.lt) && (v.not === undefined || row[k] !== v.not);
      return row[k] === v;
    });
  const table = (rows: () => any[], withRel?: (r: any) => any) => ({
    findUnique: async ({ where }: any) => {
      const r = rows().find((x) => Object.entries(where).every(([k, v]) => x[k] === v));
      return r ? (withRel ? withRel(r) : r) : null;
    },
    findMany: async ({ where, take }: any = {}) => rows().filter((r) => match(r, where)).slice(0, take ?? 1e9).map((r) => (withRel ? withRel(r) : r)),
  });
  return {
    db: {
      user: { ...table(() => state.users, (u) => ({ ...u, access: u.access ?? [] })) },
      employee: table(() => state.employees),
      category: table(() => state.categories),
      taskViewer: { findMany: async () => [] },
      apiToken: {
        ...table(() => state.tokens),
        update: async ({ where, data }: any) => Object.assign(state.tokens.find((t) => t.id === where.id), data),
      },
      task: {
        ...table(() => state.tasks, (t) => ({ ...t, assignee: state.employees.find((e) => e.id === t.assigneeId) ?? null })),
        aggregate: async () => ({ _max: { sortOrder: Math.max(0, ...state.tasks.map((t) => t.sortOrder)) } }),
        create: async ({ data }: any) => {
          const t = { id: `t${++state.seq}`, completed: false, completedAt: null, ...data };
          state.tasks.push(t);
          return t;
        },
        update: async ({ where, data }: any) => Object.assign(state.tasks.find((t) => t.id === where.id), data),
        delete: async ({ where }: any) => void state.tasks.splice(state.tasks.findIndex((t) => t.id === where.id), 1),
      },
      taskMove: { create: async ({ data }: any) => void state.moves.push(data) },
      auditLog: { create: async ({ data }: any) => void state.audits.push(data) },
    },
  };
});

const { authenticateApi } = await import("../src/lib/mcpApi/http");
const svc = await import("../src/lib/mcpApi/tasksService");

const TOKEN = newApiToken();
const admin = { id: "u1", email: "boss@bbc.test", name: "Boss", role: "ADMIN", active: true, access: [] };
const staff = { id: "u2", email: "amy@bbc.test", name: "Amy", role: "STAFF", active: true, access: [{ module: "tasks", level: "edit" }] };
const viewer = { id: "u3", email: "vic@bbc.test", name: "Vic", role: "STAFF", active: true, access: [{ module: "tasks", level: "view" }] };

const req = (token: string | null) => new Request("http://x/api/mcp/v1/tasks", { headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  state.seq = 0;
  state.users = [admin, staff, viewer].map((u) => ({ ...u }));
  state.employees = [
    { id: "e1", name: "Boss", email: admin.email, active: true, taskTab: true },
    { id: "e2", name: "Amy", email: staff.email, active: true, taskTab: true },
    { id: "e3", name: "Gone", email: null, active: true, taskTab: false },
  ];
  state.categories = [{ id: "c1", name: "Billing", sortOrder: 0 }];
  state.tasks = [
    { id: "a", title: "Boss task", notes: "n", assigneeId: "e1", categoryId: null, dueDate: "2026-11-01", completed: false, completedAt: null, sortOrder: 1 },
    { id: "b", title: "Amy task", notes: "", assigneeId: "e2", categoryId: null, dueDate: null, completed: false, completedAt: null, sortOrder: 2 },
    { id: "c", title: "Loose", notes: "", assigneeId: null, categoryId: null, dueDate: null, completed: true, completedAt: new Date(), sortOrder: 3 },
  ];
  state.tokens = [{ id: "k1", userId: "u1", scope: "tasks", tokenHash: TOKEN.hash, revokedAt: null, expiresAt: new Date(Date.now() + 1e6) }];
  state.audits = [];
  state.moves = [];
});

describe("tokens", () => {
  it("are random, prefixed, and only the hash is derivable", () => {
    const a = newApiToken();
    const b = newApiToken();
    expect(a.token).toMatch(/^bbcmcp_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashApiToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
  it("only bbcmcp_ bearers are accepted (a desktop pairing token is not)", () => {
    expect(apiBearer(`Bearer ${TOKEN.token}`)).toBe(TOKEN.token);
    expect(apiBearer("Bearer v1.abc.def")).toBeNull();
    expect(apiBearer("Bearer " + "x".repeat(43))).toBeNull();
    expect(apiBearer(null)).toBeNull();
  });
  it("clamps lifetime", () => {
    expect([clampTtlDays("x"), clampTtlDays(0), clampTtlDays(30), clampTtlDays(9999)]).toEqual([90, 90, 30, 365]);
  });
  it("has a rate-limit rule", () => {
    expect(ruleFor("GET", "/api/mcp/v1/tasks", false)?.name).toBe("mcp");
  });
});

describe("authenticateApi", () => {
  const need = { scope: "tasks", level: "view" } as const;
  it("accepts a valid token and records last use", async () => {
    const r = await authenticateApi(req(TOKEN.token), need);
    expect(r.user.email).toBe(admin.email);
    expect(state.tokens[0].lastUsedAt).toBeInstanceOf(Date);
  });
  it("rejects missing, unknown, revoked, expired tokens and inactive users", async () => {
    await expect(authenticateApi(req(null), need)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateApi(req("bbcmcp_" + "z".repeat(43)), need)).rejects.toMatchObject({ status: 401 });
    state.tokens[0].revokedAt = new Date();
    await expect(authenticateApi(req(TOKEN.token), need)).rejects.toMatchObject({ status: 401 });
    state.tokens[0].revokedAt = null;
    state.tokens[0].expiresAt = new Date(Date.now() - 1);
    await expect(authenticateApi(req(TOKEN.token), need)).rejects.toMatchObject({ status: 401 });
    state.tokens[0].expiresAt = new Date(Date.now() + 1e6);
    state.users[0].active = false;
    await expect(authenticateApi(req(TOKEN.token), need)).rejects.toMatchObject({ status: 401 });
  });
  it("enforces scope and the owner's current Tasks level, and audits the denial", async () => {
    state.tokens[0].scope = "other";
    await expect(authenticateApi(req(TOKEN.token), need)).rejects.toMatchObject({ status: 403 });
    state.tokens[0].scope = "tasks";
    state.tokens[0].userId = "u3"; // view-only owner
    await expect(authenticateApi(req(TOKEN.token), { scope: "tasks", level: "edit" })).rejects.toMatchObject({ status: 403 });
    expect(state.audits.filter((a) => a.action === "mcp.denied")).toHaveLength(2);
    await expect(authenticateApi(req(TOKEN.token), need)).resolves.toBeDefined();
  });
});

describe("shape", () => {
  it("withholds title and notes that look like patient info, naming only the kind", () => {
    const row = { id: "x", title: "Call about MRN 12345678", notes: "", assigneeId: null, categoryId: null, dueDate: null, completed: false };
    const out = toTaskOut({ ...row, notes: "DOB 3/4/1985" }, { withNotes: true });
    expect(out.title).toBe(PHI_WITHHELD);
    expect(out.notes).toBeUndefined();
    expect(out.phiWithheld).toEqual(expect.arrayContaining(["mrn", "dob"]));
    expect(JSON.stringify(out)).not.toContain("12345678");
  });
  it("omits notes in lists, includes them for a single task", () => {
    const row = { id: "x", title: "T", notes: "hello", assigneeId: null, categoryId: null, dueDate: null, completed: false };
    expect(toTaskOut(row, { withNotes: false })).toMatchObject({ hasNotes: true });
    expect(toTaskOut(row, { withNotes: false }).notes).toBeUndefined();
    expect(toTaskOut(row, { withNotes: true }).notes).toBe("hello");
  });
  it("validates bodies and queries", () => {
    expect(() => parseTaskBody({}, "create")).toThrow(/title/);
    expect(() => parseTaskBody({ title: "a", dueDate: "11/05/2026" }, "create")).toThrow(/YYYY-MM-DD/);
    expect(() => parseTaskBody({ title: "a", done: true }, "create")).toThrow(/updating/);
    expect(parseTaskBody({ title: " a ", dueDate: "", evil: 1 }, "create")).toEqual({ title: "a", dueDate: null });
    expect(() => parseListQuery(new URLSearchParams("status=bogus"))).toThrow();
    expect(parseListQuery(new URLSearchParams("limit=9999")).limit).toBe(200);
  });
});

describe("tasks service", () => {
  const u = (x: any) => state.users.find((r) => r.id === x.id);

  it("admin lists everything; non-admin only their own scope; audits without text", async () => {
    const all = await svc.listTasks(u(admin), "k1", new URLSearchParams("status=all"));
    expect(all.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    const mine = await svc.listTasks(u(staff), "k1", new URLSearchParams("status=all"));
    expect(mine.tasks.map((t) => t.id)).toEqual(["b"]);
    const open = await svc.listTasks(u(admin), "k1", new URLSearchParams(""));
    expect(open.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    const before = await svc.listTasks(u(admin), "k1", new URLSearchParams("dueBefore=2026-12-01"));
    expect(before.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(state.audits.every((a) => a.action === "mcp.task.list" && !/task/i.test(a.detail.replace(/token k1 status=\w+ count=\d+/, "")))).toBe(true);
    await expect(svc.listTasks(u(staff), "k1", new URLSearchParams("assigneeId=e1"))).rejects.toMatchObject({ status: 403 });
  });

  it("creates a task, assigns it, and logs the move and audit", async () => {
    const r = await svc.createTask(u(admin), "k1", { title: "Renew license", dueDate: "2026-12-01", assigneeId: "e2", categoryId: "c1" });
    expect(r.task).toMatchObject({ title: "Renew license", assigneeId: "e2", dueDate: "2026-12-01", categoryId: "c1", done: false });
    expect(state.moves[0]).toMatchObject({ kind: "created-for", toName: "Amy", movedBy: admin.email });
    expect(state.audits.map((a) => a.action)).toContain("mcp.task.add");
  });

  it("refuses PHI in title or notes and never stores it", async () => {
    const before = state.tasks.length;
    await expect(svc.createTask(u(admin), "k1", { title: "Call 425-555-1234" })).rejects.toMatchObject({ status: 422, code: "phi_blocked" });
    await expect(svc.updateTask(u(admin), "k1", "a", { notes: "SSN 123-45-6789" })).rejects.toMatchObject({ status: 422 });
    expect(state.tasks.length).toBe(before);
    expect(state.audits.some((a) => a.action === "task.phi_blocked")).toBe(true);
    expect(JSON.stringify(state.audits)).not.toMatch(/425|6789/);
  });

  it("rejects an assignee without a tab, a bad category, and unassigning by non-admins", async () => {
    await expect(svc.createTask(u(admin), "k1", { title: "x", assigneeId: "e3" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createTask(u(admin), "k1", { title: "x", categoryId: "nope" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateTask(u(staff), "k1", "b", { assigneeId: null })).rejects.toMatchObject({ status: 400 });
  });

  it("updates status, due date, owner and notes", async () => {
    const r = await svc.updateTask(u(admin), "k1", "a", { done: true, dueDate: "2026-12-05", assigneeId: "e2", notes: "see vendor" });
    expect(r.task).toMatchObject({ done: true, dueDate: "2026-12-05", assigneeId: "e2", notes: "see vendor" });
    expect(state.tasks[0].completedAt).toBeInstanceOf(Date);
    expect(state.moves[0]).toMatchObject({ kind: "assigned", fromName: "Boss", toName: "Amy" });
    const reopened = await svc.updateTask(u(admin), "k1", "a", { done: false });
    expect(reopened.task.done).toBe(false);
    expect(state.tasks[0].completedAt).toBeNull();
    await expect(svc.updateTask(u(admin), "k1", "a", {})).rejects.toMatchObject({ status: 400 });
  });

  it("a non-admin cannot read, change or delete someone else's task", async () => {
    await expect(svc.getTask(u(staff), "k1", "a")).rejects.toMatchObject({ status: 403 });
    await expect(svc.updateTask(u(staff), "k1", "a", { done: true })).rejects.toMatchObject({ status: 403 });
    await expect(svc.deleteTask(u(staff), "k1", "a")).rejects.toMatchObject({ status: 403 });
    expect(state.tasks.find((t) => t.id === "a")).toBeDefined();
    expect((await svc.updateTask(u(staff), "k1", "b", { done: true })).task.done).toBe(true);
  });

  it("deletes with an audit entry; unknown ids are 404", async () => {
    expect(await svc.deleteTask(u(admin), "k1", "c")).toEqual({ deleted: "c" });
    expect(state.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(state.audits.at(-1)).toMatchObject({ action: "mcp.task.delete", detail: "token k1 task c" });
    await expect(svc.getTask(u(admin), "k1", "zzz")).rejects.toMatchObject({ status: 404 });
  });

  it("options list people with tabs and categories only", async () => {
    const o = await svc.taskOptions(u(admin), "k1");
    expect(o.people).toEqual([{ id: "e1", name: "Boss" }, { id: "e2", name: "Amy" }]);
    expect(o.categories.map((c) => c.name)).toEqual(["Billing"]);
  });
});
