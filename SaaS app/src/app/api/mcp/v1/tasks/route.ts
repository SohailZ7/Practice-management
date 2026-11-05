import { authenticateApi, handle, json, readJson } from "@/lib/mcpApi/http";
import { createTask, listTasks } from "@/lib/mcpApi/tasksService";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "tasks", level: "view" });
  return json(await listTasks(user, tokenId, new URL(req.url).searchParams));
});

export const POST = handle(async (req) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "tasks", level: "edit" });
  return json(await createTask(user, tokenId, await readJson(req)), 201);
});
