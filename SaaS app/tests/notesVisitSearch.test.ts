import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { billingPatient: { findMany: vi.fn() }, visit: { findMany: vi.fn() } };
vi.mock("../src/lib/db", () => ({ db }));
vi.mock("../src/lib/audit", () => ({ audit: vi.fn() }));
const authenticate = vi.fn();
vi.mock("../src/lib/desktop/api", async () => {
  const real = await vi.importActual<typeof import("../src/lib/desktop/api")>("../src/lib/desktop/api");
  return { ...real, authenticate: (...a: unknown[]) => authenticate(...a) };
});

const { GET } = await import("../src/app/api/desktop/v1/notes/visits/search/route");
const { normalizeInitials } = await import("../src/lib/notes/visitSearch");
const call = (qs: string) => GET(new Request(`http://x/search?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ user: { email: "a@example.org" } });
  db.billingPatient.findMany.mockResolvedValue([
    { id: "p1", lastName: "Testcase", firstName: "Alpha" },
    { id: "p2", lastName: "Sample", firstName: "Bravo" },
  ]);
  db.visit.findMany.mockResolvedValue([
    { id: "v1", visitDate: "2026-11-05", apptTime: "2:00 PM", program: "KIOP-AM", appointmentType: "Follow-up", providerName: "Dr. X", transcript: "hi", documents: [{ id: "d" }], patient: { lastName: "Testcase", firstName: "Alpha" } },
  ]);
});

describe("normalizeInitials", () => {
  it("accepts AB, a.b. and A B; refuses none or more than three", () => {
    expect(normalizeInitials("ab")).toBe("AB");
    expect(normalizeInitials("A.B.")).toBe("AB");
    expect(normalizeInitials("A B")).toBe("AB");
    expect(normalizeInitials("123")).toBeNull();
    expect(normalizeInitials("ABCD")).toBeNull();
  });
});

describe("GET /notes/visits/search", () => {
  it("needs Notes view access", async () => {
    await call("date=2026-11-05");
    expect(authenticate.mock.calls[0][1]).toEqual({ module: "notes", level: "view" });
  });
  it("400 bad_query with neither parameter, bad_date for a bad date, bad_query for junk initials", async () => {
    expect(await (await call("")).json()).toEqual({ error: "bad_query" });
    expect(await (await call("date=11/05/2026")).json()).toEqual({ error: "bad_date" });
    expect((await call("initials=12")).status).toBe(400);
  });
  it("matches initials exactly, case-insensitive, and returns only visit fields", async () => {
    const r = await call("initials=at");
    expect(r.status).toBe(200);
    expect(db.visit.findMany.mock.calls[0][0].where.patientId).toEqual({ in: ["p1"] });
    expect(await r.json()).toEqual({
      visits: [{ id: "v1", date: "2026-11-05", time: "2:00 PM", program: "KIOP-AM", type: "Follow-up", provider: "Dr. X", initials: "A.T.", hasTranscript: true, hasDocuments: true }],
    });
  });
  it("filters by exact date, newest first, capped at 50", async () => {
    await call("date=2026-11-05");
    const arg = db.visit.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ visitDate: "2026-11-05" });
    expect(arg.take).toBe(50);
    expect(arg.orderBy[0]).toEqual({ visitDate: "desc" });
  });
  it("returns nothing when no patient has those initials", async () => {
    expect(await (await call("initials=ZZ")).json()).toEqual({ visits: [] });
    expect(db.visit.findMany).not.toHaveBeenCalled();
  });
});
