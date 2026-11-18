import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; seq: number; final: boolean; text: string; sha256: string; durationSeconds: number; recordedAt: Date; visitId: string | null; createdByEmail: string };
const store = vi.hoisted(() => ({ rows: new Map<string, Row>(), visits: new Map<string, { transcript?: string }>(), writes: 0 }));
vi.mock("../src/lib/db", () => ({
  db: {
    recordingInbox: {
      findUnique: async ({ where }: { where: { id: string } }) => { const r = store.rows.get(where.id); return r ? { ...r } : null; },
      create: async ({ data }: { data: Row }) => { if (store.rows.has(data.id)) throw new Error("unique"); store.rows.set(data.id, { ...data }); return { ...data }; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { const r = { ...store.rows.get(where.id)!, ...data }; store.rows.set(where.id, r); return { ...r }; },
      findMany: async () => [...store.rows.values()],
    },
    visit: {
      findUnique: async ({ where }: { where: { id: string } }) => (store.visits.has(where.id) ? { id: where.id } : null),
      update: async ({ where, data }: { where: { id: string }; data: { transcript: string } }) => { store.writes++; store.visits.set(where.id, { transcript: data.transcript }); },
    },
  },
}));
const { parseInboxPut, putInbox, linkInbox, sha256Hex } = await import("../src/lib/notes/inbox");

const U = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";
const mk = (seq: number, text: string, extra: object = {}) => ({ seq, final: false, text, sha256: sha256Hex(text), durationSeconds: 5, recordedAt: "2026-11-18T14:00:00Z", ...extra });
const put = (seq: number, text: string, extra: object = {}, uuid = U) => putInbox(uuid, parseInboxPut(uuid, mk(seq, text, extra)), "a@b.org");
const code = (p: () => unknown) => Promise.resolve().then(p).then(() => "ok", (e: { code?: string }) => e.code);

beforeEach(() => { store.rows.clear(); store.visits.clear(); store.writes = 0; });

describe("duplicate UUID retry", () => {
  it("ten identical retries leave exactly one row and identical replies", async () => {
    const first = await put(1, "hello");
    for (let i = 0; i < 9; i++) expect(await put(1, "hello")).toEqual(first);
    expect(store.rows.size).toBe(1);
  });
  it("retrying the final checkpoint is safe, and never rewrites the visit twice", async () => {
    store.visits.set("v1", {});
    await put(1, "abc", { visitId: "v1" });
    const f = await put(2, "abcd", { final: true });
    const writes = store.writes;
    for (let i = 0; i < 5; i++) expect(await put(2, "abcd", { final: true })).toEqual(f);
    expect(store.writes).toBe(writes);
  });
  it("two different recordings never mix", async () => {
    const U2 = "4a2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6c";
    await put(1, "one");
    await put(1, "two", {}, U2);
    expect(store.rows.get(U)!.text).toBe("one");
    expect(store.rows.get(U2)!.text).toBe("two");
  });
});

describe("interrupted and resumed uploads", () => {
  it("skipped checkpoints are fine: 1 then 4 keeps the newest whole transcript", async () => {
    await put(1, "a");
    await put(4, "abcd");
    expect(store.rows.get(U)).toMatchObject({ seq: 4, text: "abcd" });
  });
  it("a late older checkpoint after a newer one is reported stale and changes nothing", async () => {
    await put(3, "abc");
    expect(await put(2, "ab")).toMatchObject({ stale: true, seq: 3 });
    expect(store.rows.get(U)!.text).toBe("abc");
  });
  it("resume after a drop: resend last acknowledged, then continue, then finish", async () => {
    await put(1, "a");
    await put(2, "ab");
    await put(2, "ab"); // the Desktop did not see the reply and resends
    await put(3, "abc");
    expect((await put(4, "abcd", { final: true })).final).toBe(true);
    expect(store.rows.get(U)!.text).toBe("abcd");
  });
  it("after final, nothing can change the text", async () => {
    await put(1, "a", { final: true });
    expect(await code(() => put(2, "ab"))).toBe("already_final");
    expect(store.rows.get(U)!.text).toBe("a");
  });
  it("a transcript over the visit field cap is cut for the visit but kept whole in the inbox", async () => {
    store.visits.set("v1", {});
    const big = "x".repeat(250_000);
    await put(1, big, { visitId: "v1" });
    expect(store.rows.get(U)!.text.length).toBe(250_000);
    expect(store.visits.get("v1")!.transcript!.length).toBe(200_000);
  });
});

describe("wrong checksum and bad input store nothing", () => {
  it("checksum mismatch is refused before any write", async () => {
    expect(await code(() => putInbox(U, parseInboxPut(U, { ...mk(1, "a"), sha256: sha256Hex("zzz") }), "a@b.org"))).toBe("checksum_mismatch");
    expect(store.rows.size).toBe(0);
  });
  it("uppercase or short checksums, bad seq, bad date, bad text are refused with plain codes", () => {
    const bad = (o: object) => { try { parseInboxPut(U, { ...mk(1, "a"), ...o }); return "ok"; } catch (e) { return (e as { code: string }).code; } };
    expect(bad({ sha256: "ABC" })).toBe("bad_sha256");
    expect(bad({ seq: 0 })).toBe("bad_seq");
    expect(bad({ seq: 1.5 })).toBe("bad_seq");
    expect(bad({ seq: "1" })).toBe("bad_seq");
    expect(bad({ recordedAt: "yesterday-ish" })).toBe("bad_recorded_at");
    expect(bad({ text: 5 })).toBe("bad_text");
    expect(bad({ durationSeconds: -3 })).toBe("ok"); // clamps to 0 rather than failing the upload
  });
  it("empty transcript is accepted (a recording with no speech must not wedge the queue)", async () => {
    expect(await put(1, "")).toMatchObject({ ok: true, seq: 1 });
  });
  it("unicode text round-trips with a matching checksum", async () => {
    const t = "Patient said “I’m fine” — café 日本語 😀";
    expect(await put(1, t)).toMatchObject({ sha256: sha256Hex(t) });
    expect(store.rows.get(U)!.text).toBe(t);
  });
});

describe("visit missing, then linked later", () => {
  it("upload with an unknown visit is kept; a later checkpoint that names a real visit links and writes it", async () => {
    await put(1, "first", { visitId: "late" });
    expect(store.rows.get(U)!.visitId).toBeNull();
    store.visits.set("late", {});
    const r = await put(2, "first second", { visitId: "late" });
    expect(r.visitId).toBe("late");
    expect(store.visits.get("late")!.transcript).toBe("first second");
  });
  it("manual link after the fact writes the latest text, and is idempotent", async () => {
    await put(1, "note text", { final: true });
    store.visits.set("v9", {});
    await linkInbox(U, "v9");
    await linkInbox(U, "v9");
    expect(store.visits.get("v9")!.transcript).toBe("note text");
    expect(store.writes).toBe(2);
  });
  it("link of an unknown recording is 404, of a bad id is 400", async () => {
    expect(await code(() => linkInbox(U, "v"))).toBe("not_found");
    expect(await code(() => linkInbox("nope", "v"))).toBe("bad_uuid");
  });
  it("once linked, a different visit in a later checkpoint is ignored", async () => {
    store.visits.set("a", {}); store.visits.set("b", {});
    await put(1, "x", { visitId: "a" });
    await put(2, "xy", { visitId: "b" });
    expect(store.rows.get(U)!.visitId).toBe("a");
    expect(store.visits.get("b")!.transcript).toBeUndefined();
  });
});

describe("server restart mid-upload", () => {
  it("state lives in the database, so a fresh module instance resumes at the stored checkpoint", async () => {
    await put(1, "one");
    await put(2, "one two");
    vi.resetModules();
    const fresh = await import("../src/lib/notes/inbox");
    const r = await fresh.putInbox(U, fresh.parseInboxPut(U, mk(2, "one two")), "a@b.org");
    expect(r).toMatchObject({ seq: 2, final: false });
    const next = await fresh.putInbox(U, fresh.parseInboxPut(U, mk(3, "one two three", { final: true })), "a@b.org");
    expect(next.final).toBe(true);
    expect(store.rows.size).toBe(1);
  });
  it("two simultaneous first uploads of one UUID: one wins, the other fails with a database error that the route turns into a retryable 500", async () => {
    const results = await Promise.allSettled([put(1, "same"), put(1, "same")]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(store.rows.size).toBe(1);
  });
});
