import { audit } from "@/lib/audit";
import { authenticate, handle, json } from "@/lib/desktop/api";
import { listInbox } from "@/lib/notes/inbox";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  handle(async () => {
    const { user } = await authenticate(req, { module: "notes", level: "view" });
    const q = new URL(req.url).searchParams.get("linked");
    const out = await listInbox(q === "false" ? false : q === "true" ? true : null);
    await audit(user.email, "desktop.inbox.list", `${out.items.length} item(s)`);
    return json(out);
  })(req);
