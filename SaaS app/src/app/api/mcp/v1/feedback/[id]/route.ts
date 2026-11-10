import { ApiError, authenticateApi, handle, json, readJson } from "@/lib/mcpApi/http";
import { FeedbackError, getFeedback, listComments, setFeedbackWorkflow } from "@/lib/feedback/service";
import { agentActor, feedbackShape } from "@/lib/mcpApi/feedbackApi";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }) => {
  const { user } = await authenticateApi(req, { scope: "feedback", level: "view" });
  const item = await getFeedback(user.id, params.id);
  if (!item) throw new ApiError(404, "not_found");
  const comments = (await listComments([item.id]))[item.id] ?? [];
  return json({ item: feedbackShape(item), comments: comments.map((c) => ({ author: c.authorKind === "agent" ? "agent" : c.authorName, kind: c.authorKind, body: c.body, at: c.createdAt })) });
});

/** Body: { status?, testNotes?, comment? }. The agent may only make the moves feedback/workflow.ts allows it. */
export const PATCH = handle(async (req, { params }) => {
  const { user } = await authenticateApi(req, { scope: "feedback", level: "edit" });
  const body = await readJson(req);
  try {
    const item = await setFeedbackWorkflow(agentActor(user), params.id, { status: body.status, testNotes: body.testNotes, comment: body.comment });
    return json({ item: feedbackShape(item) });
  } catch (e) {
    if (e instanceof FeedbackError) throw new ApiError(e.status, e.code);
    throw e;
  }
});
