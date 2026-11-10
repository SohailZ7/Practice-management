import { authenticateApi, handle, json } from "@/lib/mcpApi/http";
import { listFeedbackByStatus } from "@/lib/feedback/service";
import { feedbackShape } from "@/lib/mcpApi/feedbackApi";

export const dynamic = "force-dynamic";

/** Feedback-scope token. ?status=build_it (any status word) &limit=. Oldest first. No author, no PHI fields. */
export const GET = handle(async (req) => {
  const { user } = await authenticateApi(req, { scope: "feedback", level: "view" });
  const q = new URL(req.url).searchParams;
  const items = await listFeedbackByStatus(user.id, q.get("status") ?? undefined, Number(q.get("limit") ?? 50) || 50);
  return json({ items: items.map(feedbackShape) });
});
