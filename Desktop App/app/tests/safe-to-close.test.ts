import { describe, expect, it } from "vitest";
import { safeToCloseLine } from "../src/App";

const base = { recording: false, busy: false, waiting: 0, signedIn: true };
describe("safe to close line", () => {
  it("green only when nothing is waiting and nothing is recording", () => {
    expect(safeToCloseLine(base)).toEqual({ text: "All recordings safely uploaded. Safe to close.", tone: "ok" });
  });
  it("says safe on this Mac with the count when recordings wait", () => {
    const l = safeToCloseLine({ ...base, waiting: 2 });
    expect(l.tone).toBe("warn");
    expect(l.text).toContain("2 recordings waiting to upload, safe on this Mac");
    expect(safeToCloseLine({ ...base, waiting: 1 }).text).toContain("1 recording waiting");
  });
  it("never green while recording or saving", () => {
    expect(safeToCloseLine({ ...base, recording: true }).tone).toBe("warn");
    expect(safeToCloseLine({ ...base, busy: true }).tone).toBe("warn");
  });
});
