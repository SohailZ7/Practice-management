import { audit } from "@/lib/audit";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { MAX_INBOX_TEXT, parseInboxPut, putInbox } from "@/lib/notes/inbox";

export const dynamic = "force-dynamic";

/** Desktop inbox contract v1: whole-transcript checkpoint, idempotent by recording UUID. Never fails because of the visit. */
export const PUT = (req: Request, { params }: { params: { uuid: string } }) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "notes", level: "edit" });
    const raw = await req.text();
    if (raw.length > MAX_INBOX_TEXT + 2_000) throw new ApiError(413, "too_large");
    let body: Record<string, unknown>;
    try {
      const v = JSON.parse(raw || "{}");
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("x");
      body = v as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "bad_request");
    }
    const put = parseInboxPut(params.uuid, body);
    const out = await putInbox(params.uuid, put, user);
    await audit(user.email, "desktop.inbox.put", `rec ${params.uuid} seq=${out.seq} final=${out.final} chars=${put.text.length}${put.consent ? ` consent=${put.consent.given}` : ""}`);
    return json(out);
  })(req);
