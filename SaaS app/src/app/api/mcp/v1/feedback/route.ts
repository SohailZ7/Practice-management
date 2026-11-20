import { ApiError, authenticateApi, handle, json, readJson } from "@/lib/mcpApi/http";
import { createFeedbackAsAgent, FeedbackError, listFeedbackByStatus } from "@/lib/feedback/service";
import { feedbackShape } from "@/lib/mcpApi/feedbackApi";

export const dynamic = "force-dynamic";

/** Feedback-scope token. ?status=triaged|building|on_staging|tested|released|rejected|new (old words still work) &limit=. Oldest first. No author, no PHI fields. */
export const GET = handle(async (req) => {
  const { user } = await authenticateApi(req, { scope: "feedback", level: "view" });
  const q = new URL(req.url).searchParams;
  const items = await listFeedbackByStatus(user.id, q.get("status") ?? undefined, Number(q.get("limit") ?? 50) || 50);
  return json({ items: items.map(feedbackShape) });
});

/** Body: { title, submitter, description?, scope?: ui_small|other, kind?: FEEDBACK|BUG }. Creates the item as Triaged (Accepted). Patient info is refused (422). */
export const POST = handle(async (req) => {
  const { user } = await authenticateApi(req, { scope: "feedback", level: "edit" });
  const body = await readJson(req);
  try {
    const item = await createFeedbackAsAgent(user, body);
    return json({ item: feedbackShape(item) }, 201);
  } catch (e) {
    if (e instanceof FeedbackError) throw new ApiError(e.status, e.code, e.code === "possible_phi" ? { message: "text looks like patient information" } : {});
    throw e;
  }
});
