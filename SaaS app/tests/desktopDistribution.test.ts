import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compareVersions, parseManifest, v4Request, isTarget } from "@/lib/release";
import { parseDiagnostic } from "@/lib/desktop/diagnostics";

describe("release manifest", () => {
  const good = { version: "1.0.6", notes: "n", pub_date: "2026-11-06T00:00:00Z", platforms: { "darwin-aarch64": { object: "R_1.0.6.app.tar.gz", signature: "sig", dmg: "R_1.0.6.dmg" } } };
  it("accepts a good manifest", () => expect(parseManifest(good)?.platforms["darwin-aarch64"]?.dmg).toBe("R_1.0.6.dmg"));
  it("rejects object names with paths", () => {
    expect(parseManifest({ ...good, platforms: { "darwin-aarch64": { object: "../x", signature: "s" } } })).toBeNull();
    expect(parseManifest({ ...good, platforms: { "darwin-aarch64": { object: "a/b", signature: "s" } } })).toBeNull();
  });
  it("rejects bad versions and missing signatures", () => {
    expect(parseManifest({ ...good, version: "latest" })).toBeNull();
    expect(parseManifest({ ...good, platforms: { "darwin-aarch64": { object: "a", signature: "" } } })).toBeNull();
  });
  it("compares versions numerically", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.5", "1.0.5")).toBe(0);
    expect(compareVersions("1.0.4", "1.1.0")).toBe(-1);
  });
  it("only darwin-aarch64 is a target", () => {
    expect(isTarget("darwin-aarch64")).toBe(true);
    expect(isTarget("windows-x86_64")).toBe(false);
  });
});

describe("signed link", () => {
  const r = v4Request({ bucket: "b", object: "R 1.dmg", account: "sa@p.iam.gserviceaccount.com", now: new Date("2026-11-06T12:00:00Z") });
  it("expires in 10 minutes and signs only the host", () => {
    expect(r.urlBase).toContain("X-Goog-Expires=600");
    expect(r.urlBase).toContain("X-Goog-SignedHeaders=host");
    expect(r.urlBase).toContain("/b/R%201.dmg?");
    expect(r.toSign.split("\n")[1]).toBe("20261106T120000Z");
  });
});

describe("diagnostics", () => {
  const ok = { appVersion: "1.0.5", os: "macOS 14.5", event: "upload_failed", code: "http_413" };
  it("accepts slugs", () => expect(parseDiagnostic(ok)).toEqual(ok));
  it("refuses free text", () => {
    expect(parseDiagnostic({ ...ok, code: "Jane Doe was late" })).toBeNull();
    expect(parseDiagnostic({ ...ok, event: "a".repeat(80) })).toBeNull();
  });
});

describe("wiring", () => {
  it("update, download and diagnostics all require a signed-in user", () => {
    expect(readFileSync("src/app/api/desktop/v1/update/[target]/[version]/route.ts", "utf8")).toContain("authenticate(req)");
    expect(readFileSync("src/app/api/desktop/v1/diagnostics/route.ts", "utf8")).toContain("authenticate(req)");
    expect(readFileSync("src/app/api/download/dmg/route.ts", "utf8")).toContain("requireUser()");
    expect(readFileSync("src/app/download/page.tsx", "utf8")).toContain("requireUser()");
  });
  it("diagnostics admin page is admin only and has no write actions", () => {
    const p = readFileSync("src/app/admin/diagnostics/page.tsx", "utf8");
    expect(p).toContain("requireAdmin()");
    expect(p).not.toMatch(/"use server"|action=/);
  });
  it("diagnostics table is additive", () => expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/model DesktopDiagnostic/));
});
