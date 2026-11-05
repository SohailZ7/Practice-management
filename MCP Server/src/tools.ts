// Tool definitions. Descriptions are deliberately terse: they are sent to the model on every turn.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeError, type Client } from "./client.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const NOPHI = " No patient info.";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (v: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(v) }] });
const fail = (e: unknown): Result => ({ content: [{ type: "text", text: describeError(e) }], isError: true });
const run = async (fn: () => Promise<unknown>): Promise<Result> => {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
};

/** Maps tool argument names to the API's field names, dropping undefined. */
const body = (a: Record<string, unknown>, map: Record<string, string>) =>
  Object.fromEntries(Object.entries(map).filter(([k]) => a[k] !== undefined).map(([k, api]) => [api, a[k]]));

const FIELDS = { title: "title", notes: "notes", due: "dueDate", assignee: "assigneeId", category: "categoryId" };

export function createServer(api: Client): McpServer {
  const server = new McpServer({ name: "bbc-practice", version: "0.1.0" });

  server.registerTool(
    "task_options",
    { description: "List people (assignable ids), category ids and your own id. Call before assigning.", inputSchema: {} },
    () => run(() => api.get("/options")),
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List tasks (no notes). Default: open.",
      inputSchema: {
        status: z.enum(["open", "done", "all"]).optional(),
        assignee: z.string().optional().describe("person id or 'me'"),
        due_before: date.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    (a) => {
      const sp = new URLSearchParams();
      if (a.status) sp.set("status", a.status);
      if (a.assignee) sp.set("assigneeId", a.assignee);
      if (a.due_before) sp.set("dueBefore", a.due_before);
      if (a.limit) sp.set("limit", String(a.limit));
      return run(() => api.get(`/tasks?${sp}`));
    },
  );

  server.registerTool("get_task", { description: "One task with notes.", inputSchema: { id: z.string() } }, (a) =>
    run(() => api.get(`/tasks/${encodeURIComponent(a.id)}`)),
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a task." + NOPHI,
      inputSchema: {
        title: z.string().min(1).max(300),
        notes: z.string().max(20000).optional(),
        due: date.nullable().optional(),
        assignee: z.string().nullable().optional().describe("person id; default you"),
        category: z.string().nullable().optional(),
      },
    },
    (a) => run(() => api.post("/tasks", body(a, FIELDS))),
  );

  server.registerTool(
    "update_task",
    {
      description: "Change a task's title, notes, due date, owner, category or done. null clears." + NOPHI,
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(300).optional(),
        notes: z.string().max(20000).optional(),
        due: date.nullable().optional(),
        assignee: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        done: z.boolean().optional(),
      },
    },
    (a) => run(() => api.patch(`/tasks/${encodeURIComponent(a.id)}`, body(a, { ...FIELDS, done: "done" }))),
  );

  server.registerTool(
    "complete_task",
    { description: "Mark done (or reopen with done=false).", inputSchema: { id: z.string(), done: z.boolean().optional() } },
    (a) => run(() => api.patch(`/tasks/${encodeURIComponent(a.id)}`, { done: a.done ?? true })),
  );

  server.registerTool(
    "delete_task",
    { description: "Permanently delete a task. Needs confirm=true; ask the user first.", inputSchema: { id: z.string(), confirm: z.literal(true) } },
    (a) => run(() => api.del(`/tasks/${encodeURIComponent(a.id)}`)),
  );

  return server;
}
