import { authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { desktopUpdateTask } from "@/lib/desktop/tasks";

export const dynamic = "force-dynamic";

export const PATCH = handle(async (req) => {
  const { user, session } = await authenticate(req, { module: "tasks", level: "edit" });
  const id = new URL(req.url).pathname.split("/").pop() ?? "";
  return json(await desktopUpdateTask(user, session.id, id, await readJson(req)));
});
