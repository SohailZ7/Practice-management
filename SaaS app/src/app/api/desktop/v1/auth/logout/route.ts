import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authenticate, handle, json } from "@/lib/desktop/api";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const { user, session } = await authenticate(req);
  await db.desktopSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await audit(user.email, "desktop.signout", `session ${session.id}`);
  return json({ ok: true });
});
