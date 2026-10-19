// Which columns are encrypted, and how to apply the cipher to Prisma data and results. Pure given a cipher.

import { isEncrypted, type PhiCipher } from "./phi";

/** A cipher, or a function that returns it, so reads of plaintext rows work even when no key is configured. */
export type CipherSource = PhiCipher | (() => PhiCipher);
const use = (c: CipherSource) => (typeof c === "function" ? c() : c);

/** Model name (as in schema.prisma) -> encrypted string columns. */
export const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  ScheduleEntry: ["clientInfo"],
  Provider: ["zoomPassword"],
  Task: ["notes"],
  ImportDraft: ["payload"],
};

/** Relations that lead to another encrypted model, so values inside `include` results are decrypted too. */
export const RELATIONS: Record<string, Record<string, string>> = {
  ScheduleEntry: { provider: "Provider" },
  Provider: { entries: "ScheduleEntry" },
  Employee: { tasks: "Task", provider: "Provider" },
  Category: { tasks: "Task" },
  TaskLink: { task: "Task" },
  RecurringTask: { tasks: "Task" },
};

const context = (model: string, field: string) => `${model}.${field}`;
type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Encrypts the encrypted columns of one data object (create/update payloads). Prisma operator objects ({set: ..}) are handled. */
export function encryptData(cipher: CipherSource, model: string, data: unknown): unknown {
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields || !isRow(data)) return data;
  const out: Row = { ...data };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === "string") out[f] = use(cipher).encrypt(v, context(model, f));
    else if (isRow(v) && typeof v.set === "string") out[f] = { ...v, set: use(cipher).encrypt(v.set, context(model, f)) };
  }
  return out;
}

/** Decrypts the encrypted columns of one result row, and rows of related encrypted models. Returns a new object. */
export function decryptRow(cipher: CipherSource, model: string, row: unknown): unknown {
  if (!isRow(row)) return row;
  const hasWork = (ENCRYPTED_FIELDS[model] ?? []).length > 0 || RELATIONS[model];
  if (!hasWork) return row;
  const out: Row = { ...row };
  for (const f of ENCRYPTED_FIELDS[model] ?? []) {
    if (isEncrypted(out[f])) out[f] = use(cipher).decrypt(out[f] as string, context(model, f));
  }
  for (const [rel, relModel] of Object.entries(RELATIONS[model] ?? {})) {
    const v = out[rel];
    if (Array.isArray(v)) out[rel] = v.map((r) => decryptRow(cipher, relModel, r));
    else if (isRow(v)) out[rel] = decryptRow(cipher, relModel, v);
  }
  return out;
}

export function decryptResult(cipher: CipherSource, model: string, result: unknown): unknown {
  if (Array.isArray(result)) return result.map((r) => decryptRow(cipher, model, r));
  return decryptRow(cipher, model, result);
}

/** The encrypted text of a column can't be searched or compared: refuse a where-clause that tries. */
export function assertNotFiltered(model: string, where: unknown): void {
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields || !isRow(where)) return;
  for (const [k, v] of Object.entries(where)) {
    if (fields.includes(k)) throw new Error(`${model}.${k} is encrypted and cannot be used in a query filter`);
    if (k === "AND" || k === "OR" || k === "NOT") {
      for (const part of Array.isArray(v) ? v : [v]) assertNotFiltered(model, part);
    }
  }
}
