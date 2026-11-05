import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { visit: { findUnique: vi.fn() }, visitDocument: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() } };
vi.mock("../src/lib/db", () => ({ db }));
const audit = vi.fn();
vi.mock("../src/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
const authenticate = vi.fn();
vi.mock("../src/lib/desktop/api", async () => {
  const real = await vi.importActual<typeof import("../src/lib/desktop/api")>("../src/lib/desktop/api");
  return { ...real, authenticate: (...a: unknown[]) => authenticate(...a) };
});
const generateDocuments = vi.fn();
vi.mock("../src/lib/notes/generate", () => ({ generateDocuments: (...a: unknown[]) => generateDocuments(...a) }));
const modelConfigured = vi.fn();
class ModelNotConfiguredError extends Error {}
vi.mock("../src/lib/notes/model", () => ({ makeLlm: () => vi.fn(), modelConfigured: () => modelConfigured(), ModelNotConfiguredError }));
vi.mock("../src/lib/notes/queries", () => ({ priorDocument: vi.fn().mockResolvedValue(undefined) }));

const gen = await import("../src/app/api/desktop/v1/notes/visits/[id]/generate/route");
const list = await import("../src/app/api/desktop/v1/notes/visits/[id]/documents/route");
const one = await import("../src/app/api/desktop/v1/notes/visits/[id]/documents/[docId]/route");

const visit = (over: Record<string, unknown> = {}) => ({
  id: "v1", patientId: "p1", appointmentType: "Follow-up", visitDate: "2026-11-05", providerName: "Dr A",
  transcript: "Hello", patient: { lastName: "Doe", firstName: "J" }, documents: [], ...over,
});
const post = () => gen.POST(new Request("http://x/g", { method: "POST" }), { params: { id: "v1" } });

beforeEach(() => {
  vi.resetAllMocks();
  authenticate.mockResolvedValue({ user: { email: "a@example.org" } });
  modelConfigured.mockReturnValue(true);
});

describe("POST generate", () => {
  it("200 with the created document; needs Notes edit access", async () => {
    db.visit.findUnique.mockResolvedValue(visit());
    generateDocuments.mockResolvedValue([{ kind: "FOLLOWUP", label: "Progress Note", markdown: "# Note", attention: ["a"] }]);
    db.visitDocument.create.mockResolvedValue({ id: "d1", label: "Progress Note", markdown: "# Note" });
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ documentId: "d1", title: "Progress Note", content: "# Note" });
    expect(authenticate.mock.calls[0][1]).toEqual({ module: "notes", level: "edit" });
  });
  it("returns the existing document without overwriting it", async () => {
    db.visit.findUnique.mockResolvedValue(visit({ documents: [{ id: "d0", kind: "FOLLOWUP", label: "Progress Note", markdown: "edited" }] }));
    generateDocuments.mockResolvedValue([{ kind: "FOLLOWUP", label: "Progress Note", markdown: "# New", attention: [] }]);
    const r = await post();
    expect(await r.json()).toEqual({ documentId: "d0", title: "Progress Note", content: "edited" });
    expect(db.visitDocument.create).not.toHaveBeenCalled();
  });
  it("404 not_found", async () => {
    db.visit.findUnique.mockResolvedValue(null);
    const r = await post();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
  it("409 no_transcript", async () => {
    db.visit.findUnique.mockResolvedValue(visit({ transcript: "  " }));
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "no_transcript" });
  });
  it("409 model_not_configured when no backend is set up", async () => {
    db.visit.findUnique.mockResolvedValue(visit());
    modelConfigured.mockReturnValue(false);
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "model_not_configured" });
  });
  it("409 model_not_configured when the model throws ModelNotConfiguredError", async () => {
    db.visit.findUnique.mockResolvedValue(visit());
    generateDocuments.mockRejectedValue(new ModelNotConfiguredError("x"));
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "model_not_configured" });
  });
  it("502 generate_failed on other model errors", async () => {
    db.visit.findUnique.mockResolvedValue(visit());
    generateDocuments.mockRejectedValue(new Error("boom with patient text"));
    const r = await post();
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "generate_failed" });
  });
  it("401/403 pass through from authenticate", async () => {
    const { ApiError } = await vi.importActual<typeof import("../src/lib/desktop/api")>("../src/lib/desktop/api");
    authenticate.mockRejectedValue(new ApiError(403, "forbidden"));
    expect((await post()).status).toBe(403);
  });
});

describe("GET documents", () => {
  const call = () => list.GET(new Request("http://x/d"), { params: { id: "v1" } });
  it("200 newest first with id/title/type/createdAt", async () => {
    db.visit.findUnique.mockResolvedValue({ id: "v1" });
    db.visitDocument.findMany.mockResolvedValue([{ id: "d2", label: "B", kind: "K2", createdAt: new Date("2026-11-05T12:00:00Z") }]);
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ documents: [{ id: "d2", title: "B", type: "K2", createdAt: "2026-11-05T12:00:00.000Z" }] });
    expect(db.visitDocument.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" });
    expect(authenticate.mock.calls[0][1]).toEqual({ module: "notes", level: "view" });
  });
  it("404 not_found for an unknown visit", async () => {
    db.visit.findUnique.mockResolvedValue(null);
    const r = await call();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
});

describe("GET document", () => {
  const call = () => one.GET(new Request("http://x/d"), { params: { id: "v1", docId: "d1" } });
  it("200 with the text", async () => {
    db.visitDocument.findFirst.mockResolvedValue({ id: "d1", label: "A", markdown: "# A", createdAt: new Date("2026-11-05T12:00:00Z") });
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: "d1", title: "A", content: "# A", createdAt: "2026-11-05T12:00:00.000Z" });
    expect(db.visitDocument.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", visitId: "v1" });
  });
  it("404 not_found", async () => {
    db.visitDocument.findFirst.mockResolvedValue(null);
    const r = await call();
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
});
