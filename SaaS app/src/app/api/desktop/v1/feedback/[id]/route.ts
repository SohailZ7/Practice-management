import { authenticate, handle, json, readJson, ApiError } from "@/lib/desktop/api";
import { FeedbackError, updateFeedback } from "@/lib/feedback/service";

export const dynamic = "force-dynamic";

/** The author edits their own item; anyone else gets 403. */
export const PATCH = handle(async (req) => {
  const { user } = await authenticate(req);
  const id = new URL(req.url).pathname.split("/").pop() ?? "";
  const body = await readJson(req);
  try {
    return json({ item: await updateFeedback(user, id, body, "desktop") });
  } catch (e) {
    if (e instanceof FeedbackError) throw new ApiError(e.status, e.code);
    throw e;
  }
});
