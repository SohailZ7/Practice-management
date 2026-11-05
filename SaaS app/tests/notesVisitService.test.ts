import { describe, expect, it, vi, beforeEach } from "vitest";
import { apptTimeOf, parseSchedule } from "../src/lib/notes/scheduleParse";

const db = {
  visit: { findMany: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  provider: { findMany: vi.fn() },
  trackDef: { findMany: vi.fn() },
  entryType: { findMany: vi.fn() },
  billingPatient: { findFirst: vi.fn(), create: vi.fn() },
};
vi.mock("../src/lib/db", () => ({ db }));
const audit = vi.fn();
vi.mock("../src/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));

const { addVisit, cleanApptTime, deleteVisit, deleteVisits, updateVisit, VisitError } = await import("../src/lib/notes/visitService");
const actor = { id: "u1", email: "a@example.org" };

beforeEach(() => {
  vi.clearAllMocks();
  db.visit.findMany.mockResolvedValue([]);
  db.provider.findMany.mockResolvedValue([{ name: "Dr. Example" }]);
  db.trackDef.findMany.mockResolvedValue([{ name: "KIOP-AM" }]);
  db.entryType.findMany.mockResolvedValue([]);
});

describe("appointment time from the pasted sheet", () => {
  it("takes the clock time from a psych eval cell and a track cell", () => {
    expect(apptTimeOf("2:00: Psych Eval & Admit Order")).toBe("2:00");
    expect(apptTimeOf(" KIOP-AM  9:00 - 11:30")).toBe("9:00-11:30");
    expect(apptTimeOf("BPHP-AM   9:00-12:30")).toBe("9:00-12:30");
    expect(apptTimeOf("PE: Select Time")).toBe("");
  });
  it("is set on parsed rows", () => {
    const board = ["Time\tType\tClient Info\tAbsent\tCanceled\tProvider", "2:00: Psych Eval & Admit Order\tZoom\tAlpha Testcase/40F\tFALSE\tFALSE\tDr. X"].join("\n");
    expect(parseSchedule(board, "").entries[0].apptTime).toBe("2:00");
  });
});

describe("cleanApptTime", () => {
  it("accepts and tidies typed times, and refuses nonsense", () => {
    expect(cleanApptTime("")).toBe("");
    expect(cleanApptTime("2:00 pm")).toBe("2:00 PM");
    expect(cleanApptTime("9:00 - 11:30")).toBe("9:00-11:30");
    expect(cleanApptTime("2 pm")).toBe("2 PM");
    expect(() => cleanApptTime("after lunch")).toThrow(VisitError);
    expect(cleanApptTime("14:00")).toBe("14:00");
    expect(() => cleanApptTime("2:75")).toThrow(VisitError);
    expect(() => cleanApptTime("25:00")).toThrow(VisitError);
    expect(() => cleanApptTime("13:00 PM")).toThrow(VisitError);
  });
});

describe("addVisit", () => {
  it("finds or creates the patient and stores the visit with its time", async () => {
    db.billingPatient.findFirst.mockResolvedValue(null);
    db.billingPatient.create.mockResolvedValue({ id: "p1" });
    db.visit.create.mockResolvedValue({ id: "v1" });
    await addVisit(actor, { date: "2026-11-05", patient: "Alpha Testcase", apptTime: "2:00 PM", program: "KIOP-AM" });
    expect(db.visit.create.mock.calls[0][0].data).toMatchObject({ patientId: "p1", visitDate: "2026-11-05", apptTime: "2:00 PM", program: "KIOP-AM" });
    expect(audit.mock.calls[0][2]).toBe("visit v1 2026-11-05");
  });
  it("refuses a bad date and a blank name", async () => {
    await expect(addVisit(actor, { date: "nope", patient: "A B" })).rejects.toMatchObject({ code: "bad_date" });
    await expect(addVisit(actor, { date: "2026-11-05", patient: " " })).rejects.toMatchObject({ code: "bad_patient" });
    expect(db.visit.create).not.toHaveBeenCalled();
  });
});

describe("options and strict fields", () => {
  it("builds options from tables and visits, with 15-minute slots", async () => {
    db.visit.findMany.mockResolvedValue([{ program: "BPHP-AM", appointmentType: "Follow-up", providerName: "dr. example" }]);
    const { loadVisitOptions, timeSlots } = await import("../src/lib/notes/options");
    const o = await loadVisitOptions();
    expect(o.programs).toEqual(["BPHP-AM", "KIOP-AM"]);
    expect(o.providers).toEqual(["Dr. Example"]);
    expect(o.appointmentTypes).toContain("Psych Eval");
    expect(timeSlots()[0]).toBe("6:00 AM");
    expect(timeSlots()).toContain("12:15 PM");
    expect(timeSlots().at(-1)).toBe("8:00 PM");
  });
  it("refuses a type or provider that is not listed, and stores the listed spelling", async () => {
    await expect(addVisit(actor, { date: "2026-11-05", patient: "A B", appointmentType: "Haircut" })).rejects.toMatchObject({ code: "bad_type" });
    await expect(addVisit(actor, { date: "2026-11-05", patient: "A B", providerName: "Nobody" })).rejects.toMatchObject({ code: "bad_provider" });
    db.billingPatient.findFirst.mockResolvedValue({ id: "p1" });
    db.visit.create.mockResolvedValue({ id: "v2" });
    await addVisit(actor, { date: "2026-11-05", patient: "A B", appointmentType: "follow-up", providerName: "dr. example" });
    expect(db.visit.create.mock.calls[0][0].data).toMatchObject({ appointmentType: "Follow-up", providerName: "Dr. Example" });
  });
});

describe("updateVisit and deleteVisit", () => {
  it("edits only the time and audits field names, not values", async () => {
    db.visit.findUnique.mockResolvedValue({ id: "v1" });
    db.visit.update.mockResolvedValue({ id: "v1" });
    await updateVisit(actor, "v1", { apptTime: "3:00 PM" });
    expect(db.visit.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { apptTime: "3:00 PM" } });
    expect(audit.mock.calls[0][2]).toBe("visit v1 fields=apptTime");
  });
  it("deletes an existing visit and says not_found for a missing one", async () => {
    db.visit.findUnique.mockResolvedValueOnce({ id: "v1", visitDate: "2026-11-05", documents: [{ id: "d" }] });
    await deleteVisit(actor, "v1");
    expect(db.visit.delete).toHaveBeenCalledWith({ where: { id: "v1" } });
    expect(audit.mock.calls[0][2]).toBe("visit v1 2026-11-05 documents=1");
    db.visit.findUnique.mockResolvedValueOnce(null);
    await expect(deleteVisit(actor, "x")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("deleteVisits", () => {
  it("deletes the ones found, reports the rest, audits counts only", async () => {
    db.visit.findMany.mockResolvedValue([{ id: "a", _count: { documents: 2 } }, { id: "b", _count: { documents: 0 } }]);
    const r = await deleteVisits(actor, ["a", "b", "c", "a"]);
    expect(r).toEqual({ deleted: ["a", "b"], notFound: ["c"] });
    expect(db.visit.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } } });
    expect(audit.mock.calls[0][2]).toBe("visits=2 notFound=1 documents=2");
  });
  it("does nothing for an empty list and refuses more than 200", async () => {
    expect(await deleteVisits(actor, [])).toEqual({ deleted: [], notFound: [] });
    await expect(deleteVisits(actor, Array.from({ length: 201 }, (_, i) => `i${i}`))).rejects.toMatchObject({ code: "too_many" });
    expect(db.visit.deleteMany).not.toHaveBeenCalled();
  });
});
