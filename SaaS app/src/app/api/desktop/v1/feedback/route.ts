import { authenticate, handle, json, readJson, ApiError } from "@/lib/desktop/api";
import { createFeedback, FeedbackError, listFeedback } from "@/lib/feedback/service";

export const dynamic = "force-dynamic";

/** Any signed-in recorder user. Newest first; `mine` is true on the items they may edit. */
export const GET = handle(async (req) => {
  const { user } = await authenticate(req);
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100) || 100;
  return json({ items: await listFeedback(user.id, limit) });
});

export const POST = handle(async (req) => {
  const { user } = await authenticate(req);
  const body = await readJson(req);
  try {
    return json({ item: await createFeedback(user, body, "desktop") }, 201);
  } catch (e) {
    if (e instanceof FeedbackError) throw new ApiError(e.status, e.code);
    throw e;
  }
});
