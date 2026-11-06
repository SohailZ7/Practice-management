import { db } from "@/lib/db";
import { ApiError, authenticate, handle, json } from "@/lib/desktop/api";
import { DIAG_MAX_BYTES, DIAG_MAX_PER_HOUR, DIAG_RETENTION_DAYS, parseDiagnostic } from "@/lib/desktop/diagnostics";

export const dynamic = "force-dynamic";

/** Recorder diagnostics: version, environment and a short list of event kinds and codes. The user comes from the token. */
export const POST = handle(async (req) => {
  const { user } = await authenticate(req);
  const text = await req.text();
  if (text.length > DIAG_MAX_BYTES) throw new ApiError(413, "too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, "bad_request");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "bad_request");
  const d = parseDiagnostic(raw as Record<string, unknown>);
  if (!d) throw new ApiError(400, "bad_diagnostic");
  if ((await db.desktopDiagnostic.count({ where: { userId: user.id, receivedAt: { gt: new Date(Date.now() - 3600_000) } } })) >= DIAG_MAX_PER_HOUR) throw new ApiError(429, "rate_limited");
  await db.desktopDiagnostic.create({ data: { userId: user.id, appVersion: d.appVersion, commit: d.commit, os: d.os, arch: d.arch, environment: d.environment, manual: d.manual, events: d.events } });
  await db.user.update({ where: { id: user.id }, data: { desktopVersion: d.appVersion, desktopSeenAt: new Date() } });
  await db.desktopDiagnostic.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - DIAG_RETENTION_DAYS * 86400_000) } } });
  return json({ ok: true });
});
