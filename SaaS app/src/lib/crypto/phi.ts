// Field-level encryption for the most sensitive free-text columns (AES-256-GCM) and a keyed hash for dedupe keys.
//
// Stored form:  phi:v1:<keyId>:<base64url( iv(12) | ciphertext | tag(16) )>
//   - a random 12-byte IV per value; the GCM tag authenticates the value, so any change is detected;
//   - the key id says which key encrypted it, so keys can be rotated (old keys stay available for reading);
//   - "context" (model.field) is bound as additional authenticated data, so a ciphertext copied into another
//     column or model fails to decrypt;
//   - the empty string is stored as the empty string (it carries no information, and columns default to "").
// Values that do not start with the "phi:v1:" prefix are legacy plaintext and are returned unchanged on read, which
// is what lets the app keep working while `npm run db:encrypt-phi` backfills existing rows.
//
// Keys come from the environment (put them in Secret Manager in production):
//   PHI_ENCRYPTION_KEY           base64 of 32 random bytes (current key). Generate: openssl rand -base64 32
//   PHI_ENCRYPTION_KEY_ID        id for the current key (default "k1")
//   PHI_ENCRYPTION_PREVIOUS_KEYS "id:base64,id2:base64" decrypt-only keys kept during/after a rotation

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export const PREFIX = "phi:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ID_RE = /^[A-Za-z0-9_-]{1,16}$/;

export class PhiCryptoError extends Error {}

export type KeyringConfig = { currentId: string; keys: Map<string, Buffer> };

function decodeKey(b64: string, label: string): Buffer {
  const trimmed = b64.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) throw new PhiCryptoError(`${label} is not valid base64`);
  const key = Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length !== KEY_BYTES) throw new PhiCryptoError(`${label} must decode to exactly 32 bytes (got ${key.length})`);
  return key;
}

/** Builds the keyring from environment-style settings. Throws a clear message when anything is wrong. */
export function parseKeyring(env: Record<string, string | undefined>): KeyringConfig {
  const current = env.PHI_ENCRYPTION_KEY;
  if (!current || !current.trim()) {
    throw new PhiCryptoError("PHI_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and store it in Secret Manager.");
  }
  const currentId = (env.PHI_ENCRYPTION_KEY_ID ?? "k1").trim();
  if (!ID_RE.test(currentId)) throw new PhiCryptoError("PHI_ENCRYPTION_KEY_ID must be 1-16 letters, digits, - or _");
  const keys = new Map<string, Buffer>([[currentId, decodeKey(current, "PHI_ENCRYPTION_KEY")]]);
  for (const part of (env.PHI_ENCRYPTION_PREVIOUS_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(":");
    const id = at < 0 ? "" : part.slice(0, at);
    if (!ID_RE.test(id)) throw new PhiCryptoError("PHI_ENCRYPTION_PREVIOUS_KEYS entries must look like id:base64");
    const key = decodeKey(part.slice(at + 1), `previous key ${id}`);
    const existing = keys.get(id);
    if (existing && !existing.equals(key)) throw new PhiCryptoError(`key id ${id} is used for two different keys`);
    keys.set(id, key);
  }
  return { currentId, keys };
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export const isEncrypted = (value: unknown): value is string => typeof value === "string" && value.startsWith(PREFIX);

export function createPhiCipher(config: KeyringConfig) {
  const current = config.keys.get(config.currentId)!;
  // The dedupe HMAC key is derived from the current key and never used for encryption.
  const dedupeKey = Buffer.from(hkdfSync("sha256", current, Buffer.alloc(0), "practice-management/dedupe/v1", KEY_BYTES));

  function encrypt(plain: string, context: string): string {
    if (plain === "") return "";
    if (isEncrypted(plain)) throw new PhiCryptoError("value is already encrypted"); // a double encryption would be unrecoverable by mistake
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", current, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `${PREFIX}${config.currentId}:${b64url(Buffer.concat([iv, ct, cipher.getAuthTag()]))}`;
  }

  function decrypt(value: string, context: string): string {
    if (!isEncrypted(value)) return value; // legacy plaintext (or empty)
    const rest = value.slice(PREFIX.length);
    const colon = rest.indexOf(":");
    const keyId = colon < 0 ? "" : rest.slice(0, colon);
    const key = config.keys.get(keyId);
    if (!key) throw new PhiCryptoError(`no key available for key id "${keyId}"`);
    const raw = fromB64url(rest.slice(colon + 1));
    if (raw.length < IV_BYTES + TAG_BYTES) throw new PhiCryptoError("encrypted value is truncated");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    try {
      return Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
    } catch {
      throw new PhiCryptoError("encrypted value failed authentication (tampered, wrong key or wrong field)");
    }
  }

  /** Keyed, one-way digest (base64url HMAC-SHA256) used where the database needs equality but not the text. */
  function digest(text: string): string {
    return b64url(createHmac("sha256", dedupeKey).update(text, "utf8").digest());
  }

  return { encrypt, decrypt, digest, keyId: config.currentId, hasKey: (id: string) => config.keys.has(id) };
}

export type PhiCipher = ReturnType<typeof createPhiCipher>;

let cached: PhiCipher | undefined;

/** The process-wide cipher, built from the environment on first use. */
export function phi(): PhiCipher {
  return (cached ??= createPhiCipher(parseKeyring(process.env)));
}

/** For tests and scripts that change the environment. */
export function resetPhiCipher(): void {
  cached = undefined;
}

/** Fails fast at server start when the key is missing or malformed (used by src/instrumentation.ts in production). */
export function assertKeyConfigured(env: Record<string, string | undefined> = process.env): void {
  parseKeyring(env);
}

/** The id of the key that encrypted a stored value, or null for plaintext. */
export function keyIdOf(value: string): string | null {
  if (!isEncrypted(value)) return null;
  const rest = value.slice(PREFIX.length);
  const colon = rest.indexOf(":");
  return colon < 0 ? "" : rest.slice(0, colon);
}

const DEDUPE_MARK = /\|h1:[A-Za-z0-9_-]{43}$/;
export const isKeyedDedupe = (key: string) => DEDUPE_MARK.test(key);
