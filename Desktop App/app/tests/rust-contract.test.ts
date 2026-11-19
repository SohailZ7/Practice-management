import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeUploadFailure } from "../src/lib/queue";

// 1.0.23 to 1.0.26 shipped a PUT upload that the Rust side refused to send ("Unsupported request"), and the app then
// called it "Cannot reach the practice app". These tests make that class of mismatch impossible to ship again.
const rust = readFileSync("src-tauri/src/google.rs", "utf8");
const allowed = (/pub fn check_method[\s\S]*?matches!\(method, ([^)]*)\)/.exec(rust)?.[1] ?? "").match(/"[A-Z]+"/g)?.map((m) => m.slice(1, -1)) ?? [];

describe("every HTTP method the web code sends is one the Rust side allows", () => {
  it("the allow-list includes PUT", () => { expect(allowed).toContain("PUT"); });
  it("each method used in src/ is allowed", () => {
    const used = new Set<string>();
    for (const f of readdirSync("src", { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      for (const m of readFileSync(`src/${f}`, "utf8").matchAll(/method:\s*"([A-Z]+)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const m of used) expect(allowed, `method ${m}`).toContain(m);
  });
});

describe("the message names the real cause", () => {
  const msg = (m: string) => describeUploadFailure(new Error(m), "production");
  it("DNS, firewall, timeout and redirect loops are each named in plain words", () => {
    expect(msg("Could not reach the practice app (Dns).").message).toContain("look up the server's address");
    expect(msg("Could not reach the practice app (ConnectionFailed).").message).toContain("refused or blocked");
    expect(msg("Could not reach the practice app (Io).").message).toContain("timed out");
    expect(msg("Could not reach the practice app (TooManyRedirects).").message).toContain("guest Wi-Fi");
    expect(msg("Could not reach the practice app (Dns).").kind).toBe("unreachable");
  });
  it("a refusal inside the app is never called a network problem", () => {
    const f = msg("Unsupported request.");
    expect(f.kind).toBe("app");
    expect(f.message).toContain("problem inside the app, not your network");
    expect(f.message).toContain("safe on this Mac");
    expect(f.message).not.toContain("Cannot reach");
  });
  it("a plain offline error is still the network", () => {
    expect(describeUploadFailure(new TypeError("Failed to fetch"), "production").kind).toBe("unreachable");
  });
});

import { retryAll } from "../src/lib/queue";
describe("a visit the server does not know is parked, not hammered", () => {
  it("automatic retry skips parked items; a manual retry still tries them", async () => {
    const items = [{ visit_id: "a", environment: "production", created_at: "2026-11-16T10:00:00Z", duration_seconds: 1, status: "pending" }, { visit_id: "b", environment: "production", created_at: "2026-11-18T10:00:00Z", duration_seconds: 1, status: "pending" }] as any[];
    const asked: string[] = [];
    const e = { queueList: async () => items, accessToken: async () => null, queueText: async (id: string) => { asked.push(id); return "x"; } } as any;
    await retryAll(e, new Set(["a"]));
    await retryAll(e);
    // no token: nothing is sent, but only the non-parked item is even considered on the automatic pass
    expect(asked).toEqual([]);
    const res = await retryAll(e, new Set(["a"]));
    expect(res.map((r) => r.visitId)).toEqual(["b"]);
    expect((await retryAll(e)).map((r) => r.visitId)).toEqual(["a", "b"]);
  });
});
