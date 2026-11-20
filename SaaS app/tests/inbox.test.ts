import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; seq: number; final: boolean; text: string; sha256: string; durationSeconds: number; recordedAt: Date; visitId: string | null; createdByEmail: string };
const store = vi.hoisted(() => ({ rows: new Map<string, Row>(), visits: new Map<string, { transcript?: string }>() }));
vi.mock("../src/lib/db", () => ({
  db: {
    recordingConsent: { updateMany: async () => ({ count: 0 }), findFirst: async () => null, create: async () => ({}) },
    recordingInbox: {
      findUnique: async ({ where }: { where: { id: string } }) => store.rows.get(where.id) ?? null,
      create: async ({ data }: { data: Row }) => { store.rows.set(data.id, { ...data }); return { ...data }; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { const r = { ...store.rows.get(where.id)!, ...data }; store.rows.set(where.id, r); return { ...r }; },
      findMany: async ({ where }: { where: { visitId?: unknown } }) => [...store.rows.values()].filter((r) => (where.visitId === null ? r.visitId === null : where.visitId ? r.visitId !== null : true)),
    },
    visit: {
      findUnique: async ({ where }: { where: { id: string } }) => (store.visits.has(where.id) ? { id: where.id, transcript: store.visits.get(where.id)?.transcript ?? "" } : null),
      update: async ({ where, data }: { where: { id: string }; data: { transcript: string } }) => { store.visits.set(where.id, { transcript: data.transcript }); },
    },
  },
}));
const { parseInboxPut, putInbox, linkInbox, listInbox, sha256Hex, APPEND_SEPARATOR } = await import("../src/lib/notes/inbox");

const U = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";
const body = (seq: number, text: string, extra: object = {}) => ({ seq, final: false, text, sha256: sha256Hex(text), durationSeconds: 10, recordedAt: "2026-11-18T14:03:00Z", ...extra });
const put = (seq: number, text: string, extra: object = {}) => putInbox(U, parseInboxPut(U, body(seq, text, extra)), "a@b.org");
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code);

beforeEach(() => { store.rows.clear(); store.visits.clear(); });

describe("inbox PUT", () => {
  it("accepts with no visit, echoes the stored sha256, and repeats are identical", async () => {
    const a = await put(1, "hello");
    expect(a).toMatchObject({ ok: true, uuid: U, seq: 1, sha256: sha256Hex("hello"), final: false, visitId: null });
    expect(await put(1, "hello")).toEqual(a);
  });
  it("a visit that does not exist is still accepted, not linked", async () => {
    expect((await put(1, "x", { visitId: "nope" })).visitId).toBeNull();
  });
  it("links an existing visit and writes the transcript there", async () => {
    store.visits.set("v1", {});
    expect((await put(1, "abc", { visitId: "v1" })).visitId).toBe("v1");
    await put(2, "abcdef");
    expect(store.visits.get("v1")?.transcript).toBe("abcdef");
  });
  it("lower seq is stale, same seq other text conflicts", async () => {
    await put(2, "two");
    expect(await put(1, "one")).toMatchObject({ stale: true, seq: 2, sha256: sha256Hex("two") });
    expect(await code(put(2, "different"))).toBe("seq_conflict");
  });
  it("final closes it; identical resend ok, different is already_final", async () => {
    await put(1, "a");
    const f = await put(2, "ab", { final: true });
    expect(f.final).toBe(true);
    expect(await put(2, "ab", { final: true })).toEqual(f);
    expect(await code(put(3, "abc"))).toBe("already_final");
  });
  it("rejects bad input with the contract codes", () => {
    expect(() => parseInboxPut("not-a-uuid", body(1, "a"))).toThrow(expect.objectContaining({ code: "bad_uuid" }));
    expect(() => parseInboxPut(U, { ...body(1, "a"), sha256: sha256Hex("b") })).toThrow(expect.objectContaining({ code: "checksum_mismatch" }));
    expect(() => parseInboxPut(U, body(1, "x".repeat(2_000_001)))).toThrow(expect.objectContaining({ code: "too_large" }));
  });
});

describe("link and list", () => {
  it("lists unlinked, links, is idempotent, and refuses a different visit", async () => {
    await put(1, "hi", { final: true });
    expect((await listInbox(false)).items).toHaveLength(1);
    expect(await code(linkInbox(U, "ghost"))).toBe("visit_not_found");
    store.visits.set("v1", {}); store.visits.set("v2", {});
    expect(await linkInbox(U, "v1")).toEqual({ ok: true, visitId: "v1", result: expect.any(String) });
    expect(await linkInbox(U, "v1")).toEqual({ ok: true, visitId: "v1", result: expect.any(String) });
    expect(await code(linkInbox(U, "v2"))).toBe("already_linked");
    expect((await listInbox(false)).items).toHaveLength(0);
    expect(store.visits.get("v1")?.transcript).toBe("hi");
  });
});

describe("401/403 reasons", () => {
  it("keeps error=unauthorized and adds a reason", () => {
    const src = require("node:fs").readFileSync("src/lib/desktop/api.ts", "utf8") as string;
    for (const r of ["no_token", "unknown_session", "session_revoked", "session_expired", "user_inactive", "no_module_access"]) expect(src).toContain(`"${r}"`);
    expect(src).toContain('{ error: e.code, reason: e.reason }');
  });
});

describe("synthetic check", () => {
  it("round trips with made-up text and reports ok", async () => {
    (store as unknown as { rows: Map<string, Row> }).rows.clear();
    const { db } = await import("../src/lib/db");
    (db as unknown as { recordingInbox: Record<string, unknown> }).recordingInbox.deleteMany = async () => ({ count: 0 });
    const { runSyntheticCheck } = await import("../src/lib/notes/inboxSynthetic");
    const r = await runSyntheticCheck();
    expect(r.ok).toBe(true);
    expect([...store.rows.values()][0]).toMatchObject({ final: true, seq: 2, createdByEmail: "synthetic-check@bbc.invalid" });
  });
});

describe("link never silently destroys an earlier transcript", () => {
  const OLD = "[00:01] Provider: first visit text";
  const NEW = "[00:01] Patient: recovered part";
  beforeEach(() => { store.visits.set("v1", { transcript: OLD }); });
  it("PUT with a visitId onto a visit with different text stays unlinked and writes nothing", async () => {
    expect((await put(1, NEW, { visitId: "v1" })).visitId).toBeNull();
    expect(store.visits.get("v1")?.transcript).toBe(OLD);
  });
  it("Link without a mode is 409 transcript_not_empty and writes nothing", async () => {
    await put(1, NEW);
    expect(await code(linkInbox(U, "v1"))).toBe("transcript_not_empty");
    expect(store.visits.get("v1")?.transcript).toBe(OLD);
    expect(store.rows.get(U)?.visitId).toBeNull();
  });
  it("Link with mode append adds a separator and the new text, keeps the old, and is idempotent", async () => {
    await put(1, NEW);
    expect(await linkInbox(U, "v1", "append")).toEqual({ ok: true, visitId: "v1", result: "appended" });
    expect(store.visits.get("v1")?.transcript).toBe(OLD + APPEND_SEPARATOR + NEW);
    expect(await linkInbox(U, "v1", "append")).toMatchObject({ result: "unchanged" });
    expect(store.visits.get("v1")?.transcript).toBe(OLD + APPEND_SEPARATOR + NEW);
  });
  it("append over the 200,000 cap is 409 too_long and writes nothing", async () => {
    store.visits.set("v1", { transcript: "x".repeat(199_990) });
    await put(1, NEW);
    expect(await code(linkInbox(U, "v1", "append"))).toBe("too_long");
    expect(store.visits.get("v1")?.transcript).toBe("x".repeat(199_990));
  });
  it("an empty visit, or text that extends the existing text, is still replaced", async () => {
    store.visits.set("v1", { transcript: "" });
    await put(1, NEW);
    expect(await linkInbox(U, "v1")).toMatchObject({ result: "replaced" });
    expect(store.visits.get("v1")?.transcript).toBe(NEW);
    store.visits.set("v2", { transcript: "abc" });
    const U2 = "4f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6c";
    await putInbox(U2, parseInboxPut(U2, body(1, "abcdef")), "a@b.org");
    expect(await linkInbox(U2, "v2")).toMatchObject({ result: "replaced" });
    expect(store.visits.get("v2")?.transcript).toBe("abcdef");
  });
});
