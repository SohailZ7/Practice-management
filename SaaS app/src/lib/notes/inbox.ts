// Desktop transcript inbox (contract v1): idempotent, whole-transcript checkpoints keyed by the Desktop's UUID.
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/desktop/api";
import { parseConsent, saveConsent, type ConsentInput } from "@/lib/consent/recordingConsent";

export const MAX_INBOX_TEXT = 2_000_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuidV4 = (s: string) => UUID_V4.test(s);
export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type InboxPut = { seq: number; final: boolean; text: string; sha256: string; durationSeconds: number; recordedAt: Date; visitId: string | null; consent?: ConsentInput | null };

/** Validates a PUT body. Throws ApiError with the contract's codes. */
export function parseInboxPut(uuid: string, body: Record<string, unknown>): InboxPut {
  if (!isUuidV4(uuid)) throw new ApiError(400, "bad_uuid");
  const seq = body.seq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) throw new ApiError(400, "bad_seq");
  if (typeof body.text !== "string") throw new ApiError(400, "bad_text");
  if (body.text.length > MAX_INBOX_TEXT) throw new ApiError(413, "too_large");
  if (typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.sha256)) throw new ApiError(400, "bad_sha256");
  if (sha256Hex(body.text) !== body.sha256) throw new ApiError(422, "checksum_mismatch");
  const dur = typeof body.durationSeconds === "number" && Number.isFinite(body.durationSeconds) && body.durationSeconds >= 0 ? body.durationSeconds : 0;
  const when = typeof body.recordedAt === "string" ? new Date(body.recordedAt) : new Date(NaN);
  if (Number.isNaN(when.getTime())) throw new ApiError(400, "bad_recorded_at");
  const visitId = typeof body.visitId === "string" && body.visitId ? body.visitId : null;
  return { seq, final: body.final === true, text: body.text, sha256: body.sha256, durationSeconds: dur, recordedAt: when, visitId, consent: parseConsent(body) };
}

const reply = (r: { id: string; seq: number; sha256: string; final: boolean; visitId: string | null }, extra: object = {}) => ({
  ok: true, uuid: r.id, seq: r.seq, sha256: r.sha256, final: r.final, visitId: r.visitId, ...extra,
});

/** Writes the transcript to the visit exactly as POST /notes/visits/:id/transcript does. */
async function writeToVisit(visitId: string, text: string): Promise<boolean> {
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { id: true } });
  if (!v) return false;
  await db.visit.update({ where: { id: visitId }, data: { transcript: text.slice(0, 200_000), transcriptAt: new Date() } });
  return true;
}

/** Stores the optional consent once per recording (checkpoints repeat it); ties it to the visit when there is one. */
async function storeConsent(uuid: string, p: InboxPut, user: { id?: string; email: string }, visitId: string | null) {
  if (!p.consent) return;
  const have = await db.recordingConsent.findFirst({ where: { recordingId: uuid }, select: { id: true } });
  if (!have) await saveConsent({ consent: p.consent, user, source: "desktop", visitId, recordingId: uuid });
  else if (visitId) await db.recordingConsent.updateMany({ where: { recordingId: uuid, visitId: null }, data: { visitId } });
}

export async function putInbox(uuid: string, p: InboxPut, who: string | { id?: string; email: string }) {
  const user = typeof who === "string" ? { email: who } : who;
  const email = user.email;
  const out = await putInboxCore(uuid, p, email);
  await storeConsent(uuid, p, user, out.visitId);
  return out;
}

async function putInboxCore(uuid: string, p: InboxPut, email: string) {
  const cur = await db.recordingInbox.findUnique({ where: { id: uuid } });
  let linkTo: string | null = null;
  if (p.visitId && (!cur || !cur.visitId) && (await db.visit.findUnique({ where: { id: p.visitId }, select: { id: true } }))) linkTo = p.visitId;

  if (!cur) {
    const row = await db.recordingInbox.create({
      data: { id: uuid, seq: p.seq, final: p.final, text: p.text, sha256: p.sha256, durationSeconds: p.durationSeconds, recordedAt: p.recordedAt, visitId: linkTo, createdByEmail: email },
    });
    if (linkTo) await writeToVisit(linkTo, p.text);
    return reply(row);
  }
  if (cur.final) {
    if (cur.seq === p.seq && cur.sha256 === p.sha256) return reply(cur);
    throw new ApiError(409, "already_final");
  }
  if (p.seq < cur.seq) return reply(cur, { stale: true });
  if (p.seq === cur.seq) {
    if (cur.sha256 !== p.sha256) throw new ApiError(409, "seq_conflict");
    if (p.final) {
      const row = await db.recordingInbox.update({ where: { id: uuid }, data: { final: true, durationSeconds: p.durationSeconds } });
      return reply(row);
    }
    return reply(cur);
  }
  const visitId = cur.visitId ?? linkTo;
  const row = await db.recordingInbox.update({
    where: { id: uuid },
    data: { seq: p.seq, final: p.final, text: p.text, sha256: p.sha256, durationSeconds: p.durationSeconds, recordedAt: p.recordedAt, visitId },
  });
  if (visitId) await writeToVisit(visitId, p.text);
  return reply(row);
}

export async function linkInbox(uuid: string, visitId: string) {
  if (!isUuidV4(uuid)) throw new ApiError(400, "bad_uuid");
  const cur = await db.recordingInbox.findUnique({ where: { id: uuid } });
  if (!cur) throw new ApiError(404, "not_found");
  if (cur.visitId && cur.visitId !== visitId) throw new ApiError(409, "already_linked");
  if (!(await writeToVisit(visitId, cur.text))) throw new ApiError(404, "visit_not_found");
  if (cur.visitId !== visitId) await db.recordingInbox.update({ where: { id: uuid }, data: { visitId } });
  await db.recordingConsent.updateMany({ where: { recordingId: uuid, visitId: null }, data: { visitId } });
  return { ok: true, visitId };
}

export async function listInbox(linked: boolean | null) {
  const rows = await db.recordingInbox.findMany({
    where: linked === null ? {} : linked ? { visitId: { not: null } } : { visitId: null },
    orderBy: { recordedAt: "desc" },
    take: 200,
    select: { id: true, recordedAt: true, durationSeconds: true, final: true, seq: true, visitId: true },
  });
  return { items: rows.map((r) => ({ uuid: r.id, recordedAt: r.recordedAt.toISOString(), durationSeconds: r.durationSeconds, final: r.final, seq: r.seq, visitId: r.visitId })) };
}
