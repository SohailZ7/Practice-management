import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PREFIX, PhiCryptoError, assertKeyConfigured, createPhiCipher, isEncrypted, isKeyedDedupe, keyIdOf, parseKeyring } from "../src/lib/crypto/phi";
import { ENCRYPTED_FIELDS, assertNotFiltered, decryptResult, decryptRow, encryptData } from "../src/lib/crypto/fields";
import { planScheduleEntry, planValue } from "../src/lib/crypto/backfill";
import { legacyDedupeKey, makeDedupeKey, parseOutpatientBoard } from "../src/lib/import/outpatientBoard";

const b64 = () => randomBytes(32).toString("base64");
const cipherFor = (id = "k1", key = b64(), previous = "") =>
  createPhiCipher(parseKeyring({ PHI_ENCRYPTION_KEY: key, PHI_ENCRYPTION_KEY_ID: id, PHI_ENCRYPTION_PREVIOUS_KEYS: previous }));
const CTX = "ScheduleEntry.clientInfo";

describe("AES-256-GCM field encryption", () => {
  const c = cipherFor();
  it("round-trips text, with a prefix and key id", () => {
    const stored = c.encrypt("ZZ Test, Patient 1985-01-02", CTX);
    expect(stored.startsWith(`${PREFIX}k1:`)).toBe(true);
    expect(stored).not.toContain("ZZ Test");
    expect(c.decrypt(stored, CTX)).toBe("ZZ Test, Patient 1985-01-02");
    expect(keyIdOf(stored)).toBe("k1");
    expect(isEncrypted(stored)).toBe(true);
  });
  it("uses a random IV, so the same text encrypts differently each time", () => {
    expect(c.encrypt("same", CTX)).not.toBe(c.encrypt("same", CTX));
  });
  it("leaves the empty string empty in both directions", () => {
    expect(c.encrypt("", CTX)).toBe("");
    expect(c.decrypt("", CTX)).toBe("");
  });
  it("handles unicode, emoji, newlines and very long values", () => {
    for (const text of ["Zoë Ñandú 患者 🧠", "line1\nline2\r\n\ttab", " leading and trailing ", "x".repeat(1_000_000), "a".repeat(1)]) {
      expect(c.decrypt(c.encrypt(text, CTX), CTX)).toBe(text);
    }
  });
  it("detects tampering anywhere in the value", () => {
    const stored = c.encrypt("secret note", CTX);
    const [head, body] = [stored.slice(0, stored.lastIndexOf(":") + 1), stored.slice(stored.lastIndexOf(":") + 1)];
    for (const i of [0, 5, 20, body.length - 2]) {
      const flipped = body.slice(0, i) + (body[i] === "A" ? "B" : "A") + body.slice(i + 1);
      expect(() => c.decrypt(head + flipped, CTX)).toThrow(PhiCryptoError);
    }
    expect(() => c.decrypt(head + body.slice(0, -4), CTX)).toThrow(PhiCryptoError);
    expect(() => c.decrypt(head + "AAAA", CTX)).toThrow(/truncated/);
  });
  it("fails with the wrong key", () => {
    const stored = c.encrypt("secret", CTX);
    const other = cipherFor("k1", b64());
    expect(() => other.decrypt(stored, CTX)).toThrow(/failed authentication/);
  });
  it("fails for an unknown key id", () => {
    const stored = c.encrypt("secret", CTX);
    expect(() => cipherFor("k9").decrypt(stored, CTX)).toThrow(/no key available for key id "k1"/);
  });
  it("binds the value to its field: a ciphertext moved to another column does not decrypt", () => {
    const stored = c.encrypt("secret", "Task.notes");
    expect(() => c.decrypt(stored, "Provider.zoomPassword")).toThrow(PhiCryptoError);
  });
  it("returns legacy plaintext unchanged", () => {
    expect(c.decrypt("plain old text", CTX)).toBe("plain old text");
  });
  it("refuses to encrypt something that already looks encrypted", () => {
    expect(() => c.encrypt(c.encrypt("x", CTX), CTX)).toThrow(/already encrypted/);
  });
});

describe("key rotation", () => {
  const oldKey = b64();
  const newKey = b64();
  const oldCipher = cipherFor("k1", oldKey);
  const stored = oldCipher.encrypt("rotating secret", CTX);
  it("reads old values with the previous key and writes new ones with the new key", () => {
    const rotated = cipherFor("k2", newKey, `k1:${oldKey}`);
    expect(rotated.decrypt(stored, CTX)).toBe("rotating secret");
    const fresh = rotated.encrypt("new", CTX);
    expect(keyIdOf(fresh)).toBe("k2");
    expect(rotated.decrypt(fresh, CTX)).toBe("new");
  });
  it("cannot read old values once the old key is dropped", () => {
    expect(() => cipherFor("k2", newKey).decrypt(stored, CTX)).toThrow(/no key available/);
  });
  it("re-keys values with the backfill planner", () => {
    const rotated = cipherFor("k2", newKey, `k1:${oldKey}`);
    const next = planValue(rotated, "ScheduleEntry", "clientInfo", stored, "rekey")!;
    expect(keyIdOf(next)).toBe("k2");
    expect(rotated.decrypt(next, CTX)).toBe("rotating secret");
    expect(planValue(rotated, "ScheduleEntry", "clientInfo", next, "rekey")).toBeNull();
    expect(planValue(rotated, "ScheduleEntry", "clientInfo", stored, "encrypt")).toBeNull(); // plain encrypt mode leaves it
  });
});

describe("key configuration", () => {
  it("requires a key", () => {
    expect(() => parseKeyring({})).toThrow(/PHI_ENCRYPTION_KEY is not set/);
    expect(() => assertKeyConfigured({ PHI_ENCRYPTION_KEY: "  " })).toThrow(PhiCryptoError);
  });
  it("requires exactly 32 bytes of base64", () => {
    expect(() => parseKeyring({ PHI_ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toThrow(/32 bytes/);
    expect(() => parseKeyring({ PHI_ENCRYPTION_KEY: "not base64!!" })).toThrow(/base64/);
    expect(() => parseKeyring({ PHI_ENCRYPTION_KEY: b64() })).not.toThrow();
  });
  it("validates key ids and previous keys", () => {
    expect(() => parseKeyring({ PHI_ENCRYPTION_KEY: b64(), PHI_ENCRYPTION_KEY_ID: "bad id" })).toThrow(/KEY_ID/);
    expect(() => parseKeyring({ PHI_ENCRYPTION_KEY: b64(), PHI_ENCRYPTION_PREVIOUS_KEYS: "nocolon" })).toThrow(/id:base64/);
    expect(() => parseKeyring({ PHI_ENCRYPTION_KEY: b64(), PHI_ENCRYPTION_PREVIOUS_KEYS: `k1:${b64()}` })).toThrow(/two different keys/);
  });
});

describe("applying the cipher to Prisma data", () => {
  const c = cipherFor();
  it("knows which columns are encrypted", () => {
    expect(ENCRYPTED_FIELDS).toEqual({
      ScheduleEntry: ["clientInfo"],
      Provider: ["zoomPassword"],
      Task: ["notes"],
      ImportDraft: ["payload"],
    });
  });
  it("encrypts only those columns of a create/update payload", () => {
    const out = encryptData(c, "ScheduleEntry", { clientInfo: "ZZ Name", date: "2026-01-01", providerName: "Dr X" }) as Record<string, string>;
    expect(isEncrypted(out.clientInfo)).toBe(true);
    expect(out.date).toBe("2026-01-01");
    expect(out.providerName).toBe("Dr X");
  });
  it("handles { set: } operators and leaves other models and absent fields alone", () => {
    const out = encryptData(c, "Task", { notes: { set: "ZZ n" }, title: "t" }) as { notes: { set: string }; title: string };
    expect(isEncrypted(out.notes.set)).toBe(true);
    expect(out.title).toBe("t");
    expect(encryptData(c, "User", { name: "x" })).toEqual({ name: "x" });
    expect(encryptData(c, "Task", { title: "only" })).toEqual({ title: "only" });
  });
  it("decrypts rows, arrays, null and nested relations", () => {
    const enc = encryptData(c, "Task", { notes: "ZZ secret" }) as { notes: string };
    expect((decryptRow(c, "Task", { id: "1", notes: enc.notes }) as { notes: string }).notes).toBe("ZZ secret");
    expect(decryptResult(c, "Task", null)).toBeNull();
    expect(decryptResult(c, "Task", { count: 3 })).toEqual({ count: 3 });
    const rows = decryptResult(c, "Task", [{ notes: enc.notes }, { notes: "legacy" }]) as { notes: string }[];
    expect(rows.map((r) => r.notes)).toEqual(["ZZ secret", "legacy"]);
    const pwd = encryptData(c, "Provider", { zoomPassword: "pw" }) as { zoomPassword: string };
    const nested = decryptResult(c, "ScheduleEntry", { clientInfo: "", provider: { zoomPassword: pwd.zoomPassword } }) as { provider: { zoomPassword: string } };
    expect(nested.provider.zoomPassword).toBe("pw");
    const emp = decryptResult(c, "Employee", { tasks: [{ notes: enc.notes }] }) as { tasks: { notes: string }[] };
    expect(emp.tasks[0].notes).toBe("ZZ secret");
  });
  it("refuses to filter on an encrypted column", () => {
    expect(() => assertNotFiltered("Task", { notes: { contains: "x" } })).toThrow(/encrypted/);
    expect(() => assertNotFiltered("Task", { AND: [{ OR: [{ notes: "x" }] }] })).toThrow(/encrypted/);
    expect(() => assertNotFiltered("Task", { title: "x" })).not.toThrow();
    expect(() => assertNotFiltered("User", { notes: "x" })).not.toThrow();
  });
});

describe("dedupe keys without client text", () => {
  const e = { date: "2026-08-10", section: "TRACK", timeLabel: "Track 1 8:30 - 11:00", providerName: "Dr. Khalid", clientInfo: "ZZ Last, First  (MRN 99)" };
  it("contains no client text and ends with a keyed digest", () => {
    const key = makeDedupeKey(e);
    expect(key.toLowerCase()).not.toContain("zz last");
    expect(key.toLowerCase()).not.toContain("mrn");
    expect(isKeyedDedupe(key)).toBe(true);
    expect(key.startsWith("2026-08-10|track|track 1 8:30 - 11:00|dr. khalid|h1:")).toBe(true);
  });
  it("is stable and ignores case and spacing, like the old key did", () => {
    expect(makeDedupeKey({ ...e, clientInfo: "  zz LAST, first (mrn 99)" })).toBe(makeDedupeKey(e));
  });
  it("differs when the client or any other part differs", () => {
    expect(makeDedupeKey({ ...e, clientInfo: "ZZ Other" })).not.toBe(makeDedupeKey(e));
    expect(makeDedupeKey({ ...e, timeLabel: "x" })).not.toBe(makeDedupeKey(e));
  });
  it("depends on the secret key", () => {
    expect(cipherFor().digest("same")).not.toBe(cipherFor().digest("same"));
    const k = b64();
    expect(cipherFor("k1", k).digest("same")).toBe(cipherFor("k1", k).digest("same"));
  });
  it("legacy keys are recognised as legacy", () => {
    expect(isKeyedDedupe(legacyDedupeKey(e))).toBe(false);
  });
  it("a re-parsed sheet gives identical keys (import stays idempotent)", () => {
    const grid = [
      ["Providers"], ["Dr. A"],
      [],
      ["Date", "Time", "Type", "Client Info", "Absent", "Canceled", "Provider", "Completed", "Missed"],
      ["2026-08-10", "Select time", "Eval", "ZZ One", "", "", "Dr. A", "", ""],
    ];
    const a = parseOutpatientBoard(grid).entries.map((x) => x.dedupeKey);
    expect(a.length).toBeGreaterThan(0);
    expect(parseOutpatientBoard(grid).entries.map((x) => x.dedupeKey)).toEqual(a);
  });
});

describe("backfill planning", () => {
  const c = cipherFor();
  const legacyRow = { clientInfo: "ZZ Last, First", date: "2026-08-10", section: "TRACK", timeLabel: "T1", providerName: "Dr. A", dedupeKey: "" };
  legacyRow.dedupeKey = legacyDedupeKey(legacyRow);

  it("encrypts plaintext and converts the dedupe key", () => {
    const plan = planScheduleEntry(c, legacyRow, "encrypt");
    expect(isEncrypted(plan.clientInfo)).toBe(true);
    expect(isKeyedDedupe(plan.dedupeKey)).toBe(true);
    expect(plan.dedupeKey).toBe(makeDedupeKey(legacyRow, c.digest)); // same key the app computes for a re-import
  });
  it("is idempotent: a second pass over the result changes nothing", () => {
    const plan = planScheduleEntry(c, legacyRow, "encrypt");
    const after = { ...legacyRow, ...plan };
    expect(planScheduleEntry(c, after, "encrypt")).toEqual({});
    expect(planValue(c, "Task", "notes", "", "encrypt")).toBeNull();
    const once = planValue(c, "Task", "notes", "n", "encrypt")!;
    expect(planValue(c, "Task", "notes", once, "encrypt")).toBeNull();
  });
  it("rolls back to plaintext and the old dedupe key", () => {
    const after = { ...legacyRow, ...planScheduleEntry(c, legacyRow, "encrypt") };
    const back = planScheduleEntry(c, after, "decrypt");
    expect(back.clientInfo).toBe("ZZ Last, First");
    expect(back.dedupeKey).toBe(legacyRow.dedupeKey);
    expect(planScheduleEntry(c, { ...after, ...back }, "decrypt")).toEqual({});
  });
  it("re-key recomputes dedupe keys under the new key", () => {
    const oldKey = b64();
    const oldC = cipherFor("k1", oldKey);
    const encrypted = { ...legacyRow, clientInfo: oldC.encrypt(legacyRow.clientInfo, CTX) };
    encrypted.dedupeKey = "x|h1:" + "A".repeat(43);
    const newC = cipherFor("k2", b64(), `k1:${oldKey}`);
    const plan = planScheduleEntry(newC, encrypted, "rekey");
    expect(keyIdOf(plan.clientInfo)).toBe("k2");
    expect(plan.dedupeKey).toBe(makeDedupeKey(encrypted && { ...legacyRow }, newC.digest));
  });
});
