import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { desktopPromoteFeedback } from "@/lib/desktop/tasks";
import { isStaging } from "@/lib/promote/rules";

export const dynamic = "force-dynamic";

/** Staging only (404 elsewhere, before anything else). Promotes one feedback item to production. */
export const POST = handle(async (req) => {
  if (!isStaging()) throw new ApiError(404, "not_found");
  const { user } = await authenticate(req);
  const parts = new URL(req.url).pathname.split("/");
  const id = parts[parts.length - 2] ?? "";
  return json(await desktopPromoteFeedback(user, id));
});
