import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { deleteVisit, updateVisit, VisitError, type VisitPatch } from "@/lib/notes/visitService";

export const dynamic = "force-dynamic";

const wrap = (e: unknown): never => {
  if (e instanceof VisitError) throw new ApiError(e.code === "not_found" ? 404 : 400, e.code);
  throw e;
};

/** Edits a visit's time, program, appointment type or provider. Only those keys are read. */
export const PATCH = (req: Request, { params }: { params: { id: string } }) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "notes", level: "edit" });
    const body = await readJson(req);
    const patch: VisitPatch = {};
    for (const k of ["apptTime", "program", "appointmentType", "providerName"] as const) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== "string") throw new ApiError(400, "bad_request");
      patch[k] = body[k] as string;
    }
    try {
      await updateVisit(user, params.id, patch);
    } catch (e) {
      wrap(e);
    }
    return json({ ok: true });
  })(req);

/** Deletes a visit with its transcript and documents. The recorder asks the provider to confirm first. */
export const DELETE = (req: Request, { params }: { params: { id: string } }) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "notes", level: "edit" });
    try {
      await deleteVisit(user, params.id);
    } catch (e) {
      wrap(e);
    }
    return json({ ok: true });
  })(req);
