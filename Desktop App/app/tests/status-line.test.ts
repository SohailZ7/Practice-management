import { describe, expect, it } from "vitest";
import { pillFor } from "../src/App";

const visit = {} as any;
describe("the one-line status for a recording", () => {
  it("shows the plain state at every step, in order", () => {
    expect(pillFor({ phase: "idle" } as any, false, visit)).toBeNull();
    expect(pillFor({ phase: "recording", since: 1 } as any, false, visit)?.label).toBe("Recording");
    expect(pillFor({ phase: "working", detail: "x" } as any, false, visit)?.label).toBe("Saving on this Mac…");
    expect(pillFor({ phase: "uploading" } as any, true, visit)?.label).toBe("Uploading…");
    expect(pillFor({ phase: "saved", reason: "Cannot reach the practice app." } as any, true, visit)?.label).toBe("Saved on this Mac");
    expect(pillFor({ phase: "sent" } as any, false, visit)).toEqual({ label: "Safe on server", tone: "ok" });
  });
  it("a recording waiting in the queue says Saved on this Mac even after a relaunch", () => {
    expect(pillFor({ phase: "idle" } as any, true, visit)?.label).toBe("Saved on this Mac");
  });
  it("a failure is never shown as safe", () => {
    const p = pillFor({ phase: "failed", message: "x" } as any, false, visit)!;
    expect(p.label).toBe("Failed");
    expect(p.tone).toBe("bad");
  });
  it("only a confirmed upload is green", () => {
    for (const s of [{ phase: "recording", since: 1 }, { phase: "working", detail: "" }, { phase: "uploading" }, { phase: "saved", reason: "" }, { phase: "failed", message: "" }]) {
      expect(pillFor(s as any, true, visit)?.tone).not.toBe("ok");
    }
  });
});
