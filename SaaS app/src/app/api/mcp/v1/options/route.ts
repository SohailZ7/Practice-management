import { authenticateApi, handle, json } from "@/lib/mcpApi/http";
import { taskOptions } from "@/lib/mcpApi/tasksService";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { user, tokenId } = await authenticateApi(req, { scope: "tasks", level: "view" });
  return json(await taskOptions(user, tokenId));
});
