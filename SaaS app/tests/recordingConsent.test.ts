import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type C = { id: string; visitId: string | null; recordingId: string | null; userId: string | null; userEmail: string; given: boolean; textVersion: string; source: string; givenAt: Date };
const store = vi.hoisted(() => ({ rows: [] as C[] }));
vi.mock("../src/lib/db", () => ({
  db: {
    recordingConsent: {
      create: async ({ data }: { data: Omit<C, "id"> }) => { const r = { id: `c${store.rows.length + 1}`, ...data }; store.rows.push(r); return r; },
      findMany: async ({ where }: { where: { visitId: string } }) => store.rows.filter((r) => r.visitId === where.visitId),
    },
  },
}));
const { parseConsent, saveConsent, listConsent } = await import("../src/lib/consent/recordingConsent");
const { RECORDING_CONSENT } = await import("../src/lib/consent/consentText");

beforeEach(() => { store.rows.length = 0; });

describe("consent text", () => {
  it("has one version and the drafted wording", () => {
    expect(RECORDING_CONSENT.version).toBe("2026-11-20-draft-3");
    expect(RECORDING_CONSENT.text).toContain("Is that okay with everyone?");
    expect(RECORDING_CONSENT.text).toContain("no audio is saved");
    expect(RECORDING_CONSENT.checkboxLabel).toBe("Patient (and everyone present) gave consent.");
  });
  it("the wording is defined nowhere else in src", () => {
    const grep = (f: string) => readFileSync(f, "utf8");
    expect(grep("src/components/notes/RecordingConsentDialog.tsx")).not.toContain("transcribed by an AI tool");
  });
});

describe("parseConsent (optional Desktop fields)", () => {
  it("absent means an old client and is fine", () => {
    expect(parseConsent({})).toBeNull();
  });
  it("reads given, textVersion and at", () => {
    expect(parseConsent({ consent: { given: true, textVersion: "v1", at: "2026-11-19T10:00:00Z" } })).toMatchObject({ given: true, textVersion: "v1" });
  });
  it("rejects a malformed object", () => {
    expect(() => parseConsent({ consent: { given: "yes", textVersion: "v1" } })).toThrow();
    expect(() => parseConsent({ consent: { given: true, textVersion: "" } })).toThrow();
    expect(() => parseConsent({ consent: { given: true, textVersion: "v1", at: "nope" } })).toThrow();
  });
});

describe("saveConsent / listConsent", () => {
  it("stores one record per confirmation and lists it for the visit", async () => {
    await saveConsent({ consent: { given: true, textVersion: "v1", at: new Date("2026-11-19T10:00:00Z") }, user: { id: "u1", email: "fake@example.org" }, source: "web", visitId: "visit-fake" });
    const out = await listConsent("visit-fake");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userEmail: "fake@example.org", given: true, textVersion: "v1", source: "web", at: "2026-11-19T10:00:00.000Z" });
  });
});

describe("inbox PUT body", () => {
  it("accepts the optional consent and still accepts bodies without it", async () => {
    const { parseInboxPut, sha256Hex } = await import("../src/lib/notes/inbox");
    const U = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";
    const base = { seq: 1, text: "fake", sha256: sha256Hex("fake"), recordedAt: "2026-11-19T10:00:00Z" };
    expect(parseInboxPut(U, base).consent).toBeNull();
    expect(parseInboxPut(U, { ...base, consent: { given: true, textVersion: "v1" } }).consent).toMatchObject({ given: true });
  });
});
