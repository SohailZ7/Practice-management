import { authenticateApi, handle, json, readJson } from "@/lib/mcpApi/http";
import { deleteTask, getTask, updateTask } from "@/lib/mcpApi/tasksService";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "tasks", level: "view" });
  return json(await getTask(user, tokenId, params.id));
});

export const PATCH = handle(async (req, { params }) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "tasks", level: "edit" });
  return json(await updateTask(user, tokenId, params.id, await readJson(req)));
});

export const DELETE = handle(async (req, { params }) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "tasks", level: "edit" });
  return json(await deleteTask(user, tokenId, params.id));
});
