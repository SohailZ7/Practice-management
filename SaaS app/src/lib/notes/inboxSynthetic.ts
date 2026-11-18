// Synthetic upload check: a full inbox round trip with made-up text, no patient data, run on a schedule so a broken
// upload path is noticed before a provider hits it. Uses the same service functions the Desktop routes use.
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { parseInboxPut, putInbox, sha256Hex } from "./inbox";

export const SYNTHETIC_ACTOR = "synthetic-check@bbc.invalid";

export type SyntheticResult = { ok: true; ms: number } | { ok: false; step: string; ms: number };

export async function runSyntheticCheck(now: () => number = Date.now): Promise<SyntheticResult> {
  const t0 = now();
  const done = (step?: string): SyntheticResult => (step ? { ok: false, step, ms: now() - t0 } : { ok: true, ms: now() - t0 });
  const uuid = randomUUID();
  const send = (seq: number, text: string, final: boolean) =>
    putInbox(uuid, parseInboxPut(uuid, { seq, final, text, sha256: sha256Hex(text), durationSeconds: 1, recordedAt: new Date().toISOString() }), SYNTHETIC_ACTOR);
  try {
    const t1 = "synthetic check, first checkpoint";
    const t2 = `${t1}, final at ${new Date().toISOString()}`;
    const a = await send(1, t1, false);
    if (a.sha256 !== sha256Hex(t1)) return done("checkpoint_echo");
    const b = await send(2, t2, true);
    if (!b.final || b.seq !== 2 || b.sha256 !== sha256Hex(t2)) return done("final_echo");
    const row = await db.recordingInbox.findUnique({ where: { id: uuid } });
    if (!row || sha256Hex(row.text) !== sha256Hex(t2)) return done("read_back");
    await db.recordingInbox.deleteMany({ where: { createdByEmail: SYNTHETIC_ACTOR, createdAt: { lt: new Date(now() - 24 * 3600 * 1000) } } });
    return done();
  } catch {
    return done("exception");
  }
}
