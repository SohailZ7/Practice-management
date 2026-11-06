import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ApiError, handle } from "@/lib/desktop/api";

describe("desktop API refusals are logged by code", () => {
  it("logs method, path, status and code, never the query or body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await handle(async () => { throw new ApiError(400, "bad_time"); })(
      new Request("https://x.test/api/desktop/v1/notes/visits?patient=Jane%20Doe", { method: "POST", body: '{"patient":"Jane Doe"}' }),
    );
    expect(res.status).toBe(400);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ path: "/api/desktop/v1/notes/visits", status: 400, code: "bad_time", method: "POST" });
    expect(line).not.toContain("Jane");
    warn.mockRestore();
  });
});

describe("web Add-visit form", () => {
  it("catches a thrown action and keeps the form open with an error", () => {
    const src = readFileSync("src/components/notes/NotesBoard.tsx", "utf8");
    const form = src.slice(src.indexOf("function AddVisit"), src.indexOf("function TranscriptView"));
    expect(form).toMatch(/catch \{[\s\S]*setErr\(/);
    expect(form).toMatch(/else setErr\(r\.error\)/);
  });
});
