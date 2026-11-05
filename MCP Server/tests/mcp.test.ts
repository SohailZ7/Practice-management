import { describe, expect, it } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApiFailure, describeError, loadConfig, makeClient } from "../src/client.js";
import { createServer } from "../src/tools.js";

const TOKEN = "bbcmcp_" + "a".repeat(43);

describe("loadConfig", () => {
  it("requires url and token", () => {
    expect(() => loadConfig({})).toThrow(/BBC_API_URL/);
  });
  it("rejects http except localhost, and non-Claude tokens", () => {
    expect(() => loadConfig({ BBC_API_URL: "http://example.com", BBC_API_TOKEN: TOKEN })).toThrow(/https/);
    expect(() => loadConfig({ BBC_API_URL: "https://x.run.app", BBC_API_TOKEN: "pairing-token" })).toThrow(/bbcmcp_/);
    expect(loadConfig({ BBC_API_URL: "http://localhost:3000/", BBC_API_TOKEN: TOKEN }).baseUrl).toBe("http://localhost:3000");
  });
});

type Call = { url: string; method: string; auth: string | null; body?: unknown };
function fakeFetch(reply: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: init.method!, auth: new Headers(init.headers).get("authorization"), body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function connect(reply: Parameters<typeof fakeFetch>[0]) {
  const { f, calls } = fakeFetch(reply);
  const server = createServer(makeClient({ baseUrl: "https://app.test", token: TOKEN }, f));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new McpClient({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0].text, isError: r.isError === true };
  };
  return { client, call, calls };
}

describe("tools", () => {
  it("lists exactly the task tools, with short descriptions", async () => {
    const { client } = await connect(() => ({ json: {} }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["complete_task", "create_task", "delete_task", "get_task", "list_tasks", "task_options", "update_task"]);
    for (const t of tools) expect((t.description ?? "").length).toBeLessThan(110);
  });

  it("list_tasks maps arguments to the query string and sends the bearer token", async () => {
    const { call, calls } = await connect(() => ({ json: { tasks: [] } }));
    await call("list_tasks", { status: "all", assignee: "me", due_before: "2026-12-01", limit: 5 });
    expect(calls[0].url).toBe("https://app.test/api/mcp/v1/tasks?status=all&assigneeId=me&dueBefore=2026-12-01&limit=5");
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  it("create/update map field names and omit undefined", async () => {
    const { call, calls } = await connect(() => ({ status: 200, json: { task: { id: "t1" } } }));
    await call("create_task", { title: "Call vendor", due: "2026-11-10", assignee: "e1" });
    expect(calls[0]).toMatchObject({ method: "POST", body: { title: "Call vendor", dueDate: "2026-11-10", assigneeId: "e1" } });
    await call("update_task", { id: "t1", due: null, done: true });
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://app.test/api/mcp/v1/tasks/t1", body: { dueDate: null, done: true } });
  });

  it("complete_task marks done by default and can reopen", async () => {
    const { call, calls } = await connect(() => ({ json: { task: {} } }));
    await call("complete_task", { id: "t1" });
    await call("complete_task", { id: "t1", done: false });
    expect(calls.map((c) => c.body)).toEqual([{ done: true }, { done: false }]);
  });

  it("delete_task refuses without confirm=true", async () => {
    const { call, calls } = await connect(() => ({ json: { deleted: "t1" } }));
    const bad = await call("delete_task", { id: "t1" });
    expect(bad.isError).toBe(true);
    expect(calls).toHaveLength(0);
    const good = await call("delete_task", { id: "t1", confirm: true });
    expect(good.isError).toBe(false);
    expect(calls[0].method).toBe("DELETE");
  });

  it("turns API failures into short errors without leaking the token or URL", async () => {
    const { call } = await connect(() => ({ status: 422, json: { error: "phi_blocked", message: "Looks like a phone number." } }));
    const r = await call("create_task", { title: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Looks like a phone number.");
    expect(r.text).not.toContain(TOKEN);
    expect(r.text).not.toContain("app.test");
  });
});

describe("describeError", () => {
  it("maps statuses", () => {
    expect(describeError(new ApiFailure(401, "unauthorized"))).toMatch(/expired or revoked/);
    expect(describeError(new ApiFailure(404, "not_found"))).toBe("Task not found.");
    expect(describeError(new ApiFailure(500, "server_error"))).toMatch(/error/);
    expect(describeError(new TypeError("fetch failed"))).toBe("Could not reach the practice app.");
  });
});
