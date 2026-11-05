import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { deleteVisits, VisitError } from "@/lib/notes/visitService";

export const dynamic = "force-dynamic";

/**
 * Deletes several visits with their transcripts and documents. Body: { ids: string[] } (200 at most).
 * Returns { deleted: ids, notFound: ids }. The recorder asks the provider to confirm the count first.
 */
export const POST = handle(async (req) => {
  const { user } = await authenticate(req, { module: "notes", level: "edit" });
  const body = await readJson(req);
  if (!Array.isArray(body.ids) || body.ids.some((i) => typeof i !== "string")) throw new ApiError(400, "bad_request");
  try {
    return json(await deleteVisits(user, body.ids as string[]));
  } catch (e) {
    if (e instanceof VisitError) throw new ApiError(400, e.code);
    throw e;
  }
});
