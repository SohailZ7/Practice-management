import { describe, expect, it, vi } from "vitest";
import { promoteBlocker, promoteVisit, sameVisit, type PromoteDeps } from "../src/lib/promote";
import type { Visit } from "../src/lib/api";

const v = (o: Partial<Visit> = {}): Visit => ({ id: "s1", initials: "A.B.", fullName: "Alex Bell", program: "IOP", apptTime: "9:00 AM", appointmentType: "Follow Up", providerName: "Dr. A", hasTranscript: true, documentCount: 0, ...o });
const deps = (o: Partial<PromoteDeps> = {}): PromoteDeps => ({
  readTranscript: async () => "Doctor: hello.",
  listProduction: async () => [],
  createProduction: vi.fn(async () => ({ id: "p1" })),
  pushProduction: vi.fn(async () => ({})),
  ...o,
});

describe("promote", () => {
  it("creates the visit with the full name, then sends the transcript", async () => {
    const d = deps();
    const r = await promoteVisit(v(), "2026-11-05", d);
    expect(r).toEqual({ ok: true, productionId: "p1", already: false });
    expect(d.createProduction).toHaveBeenCalledWith("2026-11-05", expect.objectContaining({ patient: "Alex Bell", apptTime: "9:00 AM", program: "IOP" }));
    expect(d.pushProduction).toHaveBeenCalledWith("p1", "Doctor: hello.");
  });
  it("refuses without a name or a transcript, and touches nothing", async () => {
    const d = deps();
    expect((await promoteVisit(v({ fullName: undefined }), "2026-11-05", d)).ok).toBe(false);
    expect((await promoteVisit(v({ hasTranscript: false }), "2026-11-05", d)).ok).toBe(false);
    expect(d.createProduction).not.toHaveBeenCalled();
    expect(promoteBlocker(v())).toBe("");
  });
  it("does not duplicate a visit already in production with its transcript", async () => {
    const d = deps({ listProduction: async () => [v({ id: "p9", fullName: undefined })] });
    expect(await promoteVisit(v(), "2026-11-05", d)).toEqual({ ok: true, productionId: "p9", already: true });
    expect(d.createProduction).not.toHaveBeenCalled();
    expect(d.pushProduction).not.toHaveBeenCalled();
  });
  it("finishes a visit that is there without its transcript", async () => {
    const d = deps({ listProduction: async () => [v({ id: "p9", hasTranscript: false })] });
    expect((await promoteVisit(v(), "2026-11-05", d)).ok).toBe(true);
    expect(d.createProduction).not.toHaveBeenCalled();
    expect(d.pushProduction).toHaveBeenCalledWith("p9", "Doctor: hello.");
  });
  it("reports a refused create and a failed upload, and can be repeated", async () => {
    const refuse = deps({ createProduction: async () => { throw new Error("bad_provider"); } });
    const r1 = await promoteVisit(v(), "2026-11-05", refuse);
    expect(r1.ok).toBe(false);
    expect(refuse.pushProduction).not.toHaveBeenCalled();
    const half = deps({ pushProduction: async () => { throw new Error("offline"); } });
    const r2 = await promoteVisit(v(), "2026-11-05", half);
    expect(r2.ok).toBe(false);
    expect((r2 as { message: string }).message).toMatch(/Press Promote again/);
  });
  it("matches by initials, time and program", () => {
    expect(sameVisit(v(), v({ apptTime: "9:00AM" }))).toBe(true);
    expect(sameVisit(v(), v({ apptTime: "10:00 AM" }))).toBe(false);
    expect(sameVisit(v({ initials: "Alex Bell", realInitials: "A.B." }), v())).toBe(true);
  });
});
