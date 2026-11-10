import { ApiError, authenticateApi, handle, json, readJson } from "@/lib/mcpApi/http";
import { addFeedbackComment, FeedbackError } from "@/lib/feedback/service";
import { agentActor } from "@/lib/mcpApi/feedbackApi";

export const dynamic = "force-dynamic";

export const POST = handle(async (req, { params }) => {
  const { user } = await authenticateApi(req, { scope: "feedback", level: "edit" });
  const body = await readJson(req);
  try {
    await addFeedbackComment({ ...agentActor(user), id: user.id }, params.id, body.body);
    return json({ ok: true }, 201);
  } catch (e) {
    if (e instanceof FeedbackError) throw new ApiError(e.status, e.code);
    throw e;
  }
});
