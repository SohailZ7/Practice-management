import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { visit: { findUnique: vi.fn(), update: vi.fn() } };
vi.mock("../src/lib/db", () => ({ db }));
const audit = vi.fn();
vi.mock("../src/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
const authenticate = vi.fn();
vi.mock("../src/lib/desktop/api", async () => {
  const real = await vi.importActual<typeof import("../src/lib/desktop/api")>("../src/lib/desktop/api");
  return { ...real, authenticate: (...a: unknown[]) => authenticate(...a) };
});

const { GET, POST } = await import("../src/app/api/desktop/v1/notes/visits/[id]/transcript/route");
const ctx = (id: string) => ({ params: { id } });
const get = (id: string) => GET(new Request("http://x/t"), ctx(id));

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ user: { email: "a@example.org" } });
});

describe("GET transcript", () => {
  it("needs Notes view access", async () => {
    db.visit.findUnique.mockResolvedValue({ transcript: "", transcriptAt: null, createdAt: new Date("2026-11-05T10:00:00Z") });
    await get("v1");
    expect(authenticate.mock.calls[0][1]).toEqual({ module: "notes", level: "view" });
  });
  it("returns the stored text and when it was saved", async () => {
    db.visit.findUnique.mockResolvedValue({ transcript: "Hello", transcriptAt: new Date("2026-11-05T12:00:00Z"), createdAt: new Date("2026-11-05T10:00:00Z") });
    const r = await get("v1");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ transcript: "Hello", updatedAt: "2026-11-05T12:00:00.000Z" });
    expect(audit.mock.calls[0][2]).toBe("visit v1 chars=5");
  });
  it("returns empty text (falling back to createdAt) when none is stored", async () => {
    db.visit.findUnique.mockResolvedValue({ transcript: "", transcriptAt: null, createdAt: new Date("2026-11-05T10:00:00Z") });
    expect(await (await get("v1")).json()).toEqual({ transcript: "", updatedAt: "2026-11-05T10:00:00.000Z" });
  });
  it("404 not_found for an unknown visit", async () => {
    db.visit.findUnique.mockResolvedValue(null);
    const r = await get("nope");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
});

describe("POST transcript", () => {
  it("stamps transcriptAt when saving", async () => {
    db.visit.findUnique.mockResolvedValue({ id: "v1" });
    const r = await POST(new Request("http://x/t", { method: "POST", body: JSON.stringify({ transcript: "Hi" }) }), ctx("v1"));
    expect(r.status).toBe(200);
    expect(db.visit.update.mock.calls[0][0].data.transcriptAt).toBeInstanceOf(Date);
  });
});
