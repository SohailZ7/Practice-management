import { describe, expect, it } from "vitest";
import { outcome, rollup } from "@/lib/patients/stats";

const T = "2026-11-19";
const v = (o: Partial<Parameters<typeof rollup>[0][number]> = {}) => ({ patientId: "p1", date: "2026-11-10", status: "seen", provider: "Dr A", program: "PHP", type: "Eval", ...o });
const e = (o: Record<string, unknown> = {}) => ({ patientId: "p1", date: "2026-11-11", completed: false, absent: false, canceled: false, missed: false, provider: "Dr B", program: "IOP", type: "", ...o }) as Parameters<typeof rollup>[1][number];

describe("patient rollup", () => {
  it("outcome precedence and upcoming/unmarked by date", () => {
    expect(outcome({ completed: true, absent: false, canceled: true, missed: false }, "2026-01-01", T)).toBe("canceled");
    expect(outcome({ completed: false, absent: false, canceled: false, missed: false }, T, T)).toBe("upcoming");
    expect(outcome({ completed: false, absent: false, canceled: false, missed: false }, "2026-11-18", T)).toBe("unmarked");
  });
  it("counts visits and unmirrored entries, last seen, providers, types, program", () => {
    const r = rollup([v(), v({ date: "2026-11-12", status: "no_show", provider: "Dr C" }), v({ date: "2026-11-25", status: "scheduled" })], [e({ completed: true }), e({ missed: true, date: "2026-11-15" })], T).get("p1")!;
    expect(r).toMatchObject({ appointments: 5, seen: 2, absent: 1, missed: 1, upcoming: 1, lastSeen: "2026-11-11", lastProvider: "Dr B" });
    expect(r.providers).toEqual([{ name: "Dr A", visits: 1 }, { name: "Dr B", visits: 1 }]);
    expect(r.visitTypes).toEqual(["Eval"]);
    expect(r.currentProgram).toBe("PHP");
  });
  it("keeps patients apart and handles none", () => {
    const m = rollup([v(), v({ patientId: "p2", status: "cancelled" })], [], T);
    expect(m.get("p1")!.seen).toBe(1);
    expect(m.get("p2")!.canceled).toBe(1);
    expect(rollup([], [], T).size).toBe(0);
  });
});
