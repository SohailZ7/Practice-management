// Pure planning for `npm run db:encrypt-phi`: given a stored value, what should it become? Kept free of the database so
// it is unit-tested. Modes:
//   encrypt  encrypt plaintext values; leave already-encrypted ones alone (idempotent)
//   rekey    also re-encrypt values written with an older key id, and recompute dedupe keys with the current key
//   decrypt  roll back to plaintext (and the old plaintext dedupe key format)

import { ENCRYPTED_FIELDS } from "./fields";
import { isEncrypted, isKeyedDedupe, keyIdOf, type PhiCipher } from "./phi";
import { legacyDedupeKey, makeDedupeKey } from "../import/outpatientBoard";

export type Mode = "encrypt" | "rekey" | "decrypt";

/** The new stored value, or null when nothing needs to change. */
export function planValue(cipher: PhiCipher, model: string, field: string, current: string, mode: Mode): string | null {
  const ctx = `${model}.${field}`;
  if (current === "") return null;
  if (mode === "decrypt") return isEncrypted(current) ? cipher.decrypt(current, ctx) : null;
  if (!isEncrypted(current)) return cipher.encrypt(current, ctx);
  if (mode === "rekey" && keyIdOf(current) !== cipher.keyId) return cipher.encrypt(cipher.decrypt(current, ctx), ctx);
  return null;
}

type EntryRow = { clientInfo: string; dedupeKey: string; date: string; section: string; timeLabel: string; providerName: string };

/** Column updates for one ScheduleEntry row (empty object = nothing to do). */
export function planScheduleEntry(cipher: PhiCipher, row: EntryRow, mode: Mode): Record<string, string> {
  const out: Record<string, string> = {};
  const clientInfo = planValue(cipher, "ScheduleEntry", "clientInfo", row.clientInfo, mode);
  if (clientInfo !== null) out.clientInfo = clientInfo;
  const plain = cipher.decrypt(row.clientInfo, "ScheduleEntry.clientInfo");
  const parts = { date: row.date, section: row.section, timeLabel: row.timeLabel, providerName: row.providerName, clientInfo: plain };
  const wanted = mode === "decrypt" ? legacyDedupeKey(parts) : makeDedupeKey(parts, (t) => cipher.digest(t));
  const needs = mode === "encrypt" ? !isKeyedDedupe(row.dedupeKey) : row.dedupeKey !== wanted;
  if (needs) out.dedupeKey = wanted;
  return out;
}

export const BACKFILL_TARGETS = Object.entries(ENCRYPTED_FIELDS).flatMap(([model, fields]) => fields.map((field) => ({ model, field })));
