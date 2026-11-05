import { authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { desktopCreateTask, desktopListTasks } from "@/lib/desktop/tasks";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { user, session } = await authenticate(req, { module: "tasks", level: "view" });
  return json(await desktopListTasks(user, session.id, new URL(req.url).searchParams.get("status")));
});

export const POST = handle(async (req) => {
  const { user, session } = await authenticate(req, { module: "tasks", level: "edit" });
  return json(await desktopCreateTask(user, session.id, await readJson(req)), 201);
});
