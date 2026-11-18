import { audit } from "@/lib/audit";
import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { linkInbox } from "@/lib/notes/inbox";

export const dynamic = "force-dynamic";

export const POST = (req: Request, { params }: { params: { uuid: string } }) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "notes", level: "edit" });
    const body = await readJson(req);
    if (typeof body.visitId !== "string" || !body.visitId) throw new ApiError(400, "bad_request");
    const out = await linkInbox(params.uuid, body.visitId);
    await audit(user.email, "desktop.inbox.link", `rec ${params.uuid} visit ${out.visitId}`);
    return json(out);
  })(req);
