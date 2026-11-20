import { describe, it, expect } from "vitest";
import { isOrdersOnly } from "@/lib/notes/ordersOnly";
import { rollup } from "@/lib/patients/stats";

describe("orders only is not a visit", () => {
  it("detects the wording used in the lists", () => {
    for (const t of ["D/C Orders Only", "DC Orders Only", "Admit Orders Only", "orders only"]) expect(isOrdersOnly(t)).toBe(true);
    for (const t of ["Follow-up", "Psych Eval & Admit Order", "", null, undefined]) expect(isOrdersOnly(t)).toBe(false);
  });
  it("leaves orders-only rows out of the patient appointment counts", () => {
    const v = (type: string, status: string, date: string) => ({ patientId: "p1", date, status, provider: "Dr A", program: "", type });
    const r = rollup([v("Follow-up", "seen", "2026-11-01"), v("D/C Orders Only", "seen", "2026-11-02"), v("Admit Orders Only", "scheduled", "2026-11-30")], [], "2026-11-19").get("p1")!;
    expect(r.appointments).toBe(1);
    expect(r.seen).toBe(1);
    expect(r.upcoming).toBe(0);
    expect(r.lastSeen).toBe("2026-11-01");
  });
});
