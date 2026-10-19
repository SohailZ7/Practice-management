import { db } from "@/lib/db";
import { authenticate, handle, json } from "@/lib/desktop/api";

export const dynamic = "force-dynamic";

// API-5: names only. Zoom password and NPI are never returned (SCH-3).
export const GET = handle(async (req) => {
  await authenticate(req, { module: "schedule", level: "view" });
  const providers = await db.provider.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return json({ providers });
});
