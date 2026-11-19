// Recording-consent storage. The wording and its version live only in ./consentText.
import { db } from "@/lib/db";
import { ApiError } from "@/lib/desktop/api";

export { RECORDING_CONSENT } from "./consentText";

export type ConsentInput = { given: boolean; textVersion: string; at: Date | null };

/** Reads the optional `consent` object of an upload. Absent means an older client: returns null, never an error. */
export function parseConsent(body: Record<string, unknown>): ConsentInput | null {
  const c = body.consent;
  if (c === undefined || c === null) return null;
  if (typeof c !== "object" || Array.isArray(c)) throw new ApiError(400, "bad_consent");
  const o = c as Record<string, unknown>;
  if (typeof o.given !== "boolean") throw new ApiError(400, "bad_consent");
  if (typeof o.textVersion !== "string" || !o.textVersion.trim() || o.textVersion.length > 64) throw new ApiError(400, "bad_consent");
  let at: Date | null = null;
  if (o.at !== undefined && o.at !== null) {
    at = typeof o.at === "string" ? new Date(o.at) : new Date(NaN);
    if (Number.isNaN(at.getTime())) throw new ApiError(400, "bad_consent");
  }
  return { given: o.given, textVersion: o.textVersion.trim(), at };
}

export async function saveConsent(a: {
  consent: ConsentInput; user: { id?: string; email: string }; source: "web" | "desktop"; visitId?: string | null; recordingId?: string | null;
}) {
  return db.recordingConsent.create({
    data: {
      visitId: a.visitId ?? null, recordingId: a.recordingId ?? null, userId: a.user.id ?? null, userEmail: a.user.email,
      given: a.consent.given, textVersion: a.consent.textVersion, source: a.source, givenAt: a.consent.at ?? new Date(),
    },
  });
}

export async function listConsent(visitId: string) {
  const rows = await db.recordingConsent.findMany({ where: { visitId }, orderBy: { givenAt: "desc" }, take: 20 });
  return rows.map((r) => ({ id: r.id, userEmail: r.userEmail, given: r.given, textVersion: r.textVersion, source: r.source, at: r.givenAt.toISOString() }));
}
