import { describe, expect, it, vi } from "vitest";
import { ApiError, handle } from "../src/lib/desktop/api";

const req = (path = "/api/desktop/v1/x?secret=1") => new Request("http://t" + path, { method: "POST" });

describe("desktop API error replies are plain, JSON and safe", () => {
  for (const [status, codeName] of [[400, "bad_request"], [401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [409, "seq_conflict"], [413, "too_large"], [422, "checksum_mismatch"], [429, "rate_limited"]] as const) {
    it(`${status} ${codeName}`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const res = await handle(async () => { throw new ApiError(status, codeName); })(req());
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: codeName });
    });
  }
  it("401 with a reason keeps error=unauthorized", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await handle(async () => { throw new ApiError(401, "unauthorized", undefined, "session_expired"); })(req());
    expect(await res.json()).toEqual({ error: "unauthorized", reason: "session_expired" });
  });
  it("an unexpected crash (database down, timeout, bug) is a plain 500 that leaks nothing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const boom of [new Error("connect ETIMEDOUT 10.0.0.1:5432 patient=Jane Doe"), "string failure", null, new TypeError("x is undefined")]) {
      const res = await handle(async () => { throw boom; })(req());
      expect(res.status).toBe(500);
      const text = JSON.stringify(await res.json());
      expect(text).toBe('{"error":"server_error"}');
    }
    for (const call of err.mock.calls) expect(JSON.stringify(call)).not.toMatch(/Jane|ETIMEDOUT|patient/);
  });
  it("logs a refusal with path but without the query string", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await handle(async () => { throw new ApiError(404, "not_found"); })(req("/api/desktop/v1/notes/visits/abc?name=Jane"));
    const line = String(warn.mock.calls.at(-1)?.[0]);
    expect(line).toContain("/api/desktop/v1/notes/visits/abc");
    expect(line).not.toContain("Jane");
  });
  it("a successful handler passes straight through", async () => {
    const res = await handle(async () => new Response("ok", { status: 201 }))(req());
    expect(res.status).toBe(201);
  });
});
