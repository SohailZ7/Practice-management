import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = {
  visit: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  provider: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  scheduleEntry: { deleteMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
};
vi.mock("../src/lib/db", () => ({ db }));
vi.mock("../src/lib/audit", () => ({ audit: vi.fn() }));
const authenticate = vi.fn();
vi.mock("../src/lib/desktop/api", async () => {
  const real = await vi.importActual<typeof import("../src/lib/desktop/api")>("../src/lib/desktop/api");
  return { ...real, authenticate: (...a: unknown[]) => authenticate(...a) };
});

const { visitsForDate } = await import("../src/lib/notes/queries");
const { POST } = await import("../src/app/api/desktop/v1/notes/visits/[id]/transcript/route");
const { assertBillableVisit, TRACKING_ONLY_MESSAGE } = await import("../src/lib/notes/trackingOnly");

const visit = (id: string, apptTime: string, providerName: string) => ({
  id, patientId: "p" + id, visitDate: "2026-11-17", appointmentType: "Follow-up", program: "", apptTime, providerName, status: "SCHEDULED",
  transcript: "", createdAt: new Date(), patient: { firstName: "Jane", lastName: "Roe" }, documents: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  db.provider.findMany.mockResolvedValue([{ name: "Fitsum Belay" }]);
});

describe("tracking-only visits", () => {
  it("are flagged on the board and sorted by time, exact time before a range ending at the same time", async () => {
    db.visit.findMany.mockResolvedValue([visit("a", "9:00 AM-12:00 PM", "Dr. K"), visit("b", "12:00 PM", "Fitsum Belay"), visit("c", "8:30 AM", "Dr. K")]);
    const rows = await visitsForDate("2026-11-17");
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"].sort((x, y) => (x === "c" ? -1 : y === "c" ? 1 : x === "b" ? -1 : 1)));
    expect(rows.find((r) => r.id === "b")?.trackingOnly).toBe(true);
    expect(rows.find((r) => r.id === "a")?.trackingOnly).toBe(false);
  });

  it("show the full name only when the viewer may", async () => {
    db.visit.findMany.mockResolvedValue([visit("a", "9:00 AM", "Dr. K")]);
    expect((await visitsForDate("2026-11-17"))[0].fullName).toBeUndefined();
    expect((await visitsForDate("2026-11-17", { fullNames: true }))[0].fullName).toBe("Jane Roe");
  });

  it("refuse a transcript from the recorder", async () => {
    authenticate.mockResolvedValue({ user: { email: "a@example.org" } });
    db.visit.findUnique.mockResolvedValue({ id: "b", providerName: "Fitsum Belay" });
    db.provider.count.mockResolvedValue(1);
    const res = await POST(new Request("http://x/t", { method: "POST", body: JSON.stringify({ transcript: "hello" }) }), { params: { id: "b" } });
    expect(res.status).toBe(409);
    expect(db.visit.update).not.toHaveBeenCalled();
  });

  it("refuse documents and web transcripts through the shared guard", async () => {
    db.visit.findUnique.mockResolvedValue({ providerName: "Fitsum Belay" });
    db.provider.count.mockResolvedValue(1);
    await expect(assertBillableVisit("b")).rejects.toThrow(TRACKING_ONLY_MESSAGE);
    db.provider.count.mockResolvedValue(0);
    await expect(assertBillableVisit("b")).resolves.toBeUndefined();
  });

  it("every write path asks the guard", () => {
    expect(readFileSync("src/app/notes/actions.ts", "utf8").match(/assertBillableVisit\(|isTrackingOnlyName\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(readFileSync("src/lib/notes/docService.ts", "utf8")).toContain("isTrackingOnlyName(visit.providerName)");
  });
});

describe("provider column and clock", () => {
  it("only providers and admins may change a visit's provider", () => {
    const a = readFileSync("src/app/notes/actions.ts", "utf8");
    expect(a).toMatch(/patch\.providerName !== undefined/);
    expect(a).toContain("providerChangeError(user.role");
  });
  it("the Provider column and full names are shown to providers and admins only", () => {
    const p = readFileSync("src/app/schedule/page.tsx", "utf8");
    expect(p).toContain('user.role === "ADMIN" || user.role === "PROVIDER"');
    expect(p).toContain("fullNames: isProviderish && user.showFullNames");
  });
});
