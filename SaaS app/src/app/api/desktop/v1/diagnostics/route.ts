import { db } from "@/lib/db";
import { ApiError, authenticate, handle, json, readJson } from "@/lib/desktop/api";
import { DIAG_RETENTION_DAYS, parseDiagnostic } from "@/lib/desktop/diagnostics";

export const dynamic = "force-dynamic";

const MAX_PER_HOUR = 60;

/** The recorder reports an event and an error code (never a body or a message). Body: { appVersion, os, event, code }. */
export const POST = handle(async (req) => {
  const { user } = await authenticate(req);
  const d = parseDiagnostic(await readJson(req));
  if (!d) throw new ApiError(400, "bad_diagnostic");
  const since = new Date(Date.now() - 3600_000);
  if ((await db.desktopDiagnostic.count({ where: { userId: user.id, createdAt: { gt: since } } })) >= MAX_PER_HOUR) throw new ApiError(429, "rate_limited");
  await db.desktopDiagnostic.create({ data: { userId: user.id, ...d } });
  // Retention: old rows are removed as new ones arrive.
  await db.desktopDiagnostic.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - DIAG_RETENTION_DAYS * 86400_000) } } });
  return json({ ok: true }, 201);
});
