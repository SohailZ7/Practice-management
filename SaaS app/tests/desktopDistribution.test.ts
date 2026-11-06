import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compareVersions, parseManifest, v4Request, isTarget } from "@/lib/release";
import { parseDiagnostic } from "@/lib/desktop/diagnostics";

describe("release manifest", () => {
  const good = { version: "1.0.6", commit: "abc1234", notes: "n", pub_date: "2026-11-06T00:00:00Z", dmg: "releases/1.0.6/Practice-Recorder-1.0.6.dmg", platforms: { "darwin-aarch64": { object: "releases/1.0.6/Practice Recorder.app.tar.gz", signature: "sig" } } };
  it("accepts the Desktop agent's shape (paths with slashes and spaces)", () => {
    const m = parseManifest(good);
    expect(m?.platforms["darwin-aarch64"]?.object).toBe("releases/1.0.6/Practice Recorder.app.tar.gz");
    expect(m?.dmg).toBe("releases/1.0.6/Practice-Recorder-1.0.6.dmg");
  });
  it("rejects traversal and absolute paths", () => {
    for (const object of ["../x", "releases/../x", "/etc/passwd", "a//b"]) expect(parseManifest({ ...good, platforms: { "darwin-aarch64": { object, signature: "s" } } })).toBeNull();
    expect(parseManifest({ ...good, dmg: "../x.dmg" })).toBeNull();
  });
  it("rejects bad versions and missing signatures", () => {
    expect(parseManifest({ ...good, version: "latest" })).toBeNull();
    expect(parseManifest({ ...good, platforms: { "darwin-aarch64": { object: "a", signature: "" } } })).toBeNull();
  });
  it("compares versions numerically", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("1.0.5", "1.0.5")).toBe(0);
  });
  it("only darwin-aarch64 is a target", () => {
    expect(isTarget("darwin-aarch64")).toBe(true);
    expect(isTarget("windows-x86_64")).toBe(false);
  });
});

describe("signed link", () => {
  const r = v4Request({ bucket: "b", object: "R 1.dmg", account: "sa@p.iam.gserviceaccount.com", now: new Date("2026-11-06T12:00:00Z") });
  it("expires in 15 minutes and signs only the host", () => {
    expect(r.urlBase).toContain("X-Goog-Expires=900");
    expect(r.urlBase).toContain("X-Goog-SignedHeaders=host");
    expect(r.urlBase).toContain("/b/R%201.dmg?");
    expect(r.toSign.split("\n")[1]).toBe("20261106T120000Z");
  });
});

describe("diagnostics", () => {
  const ok = { appVersion: "1.0.6", commit: "abc1234", os: "macOS 14.5", arch: "aarch64", environment: "production", manual: false, events: [{ ts: "2026-11-06T12:00:00Z", kind: "api", code: "http_400", route: "/api/desktop/v1/notes/visits?date=2026-11-06", detail: "bad_time" }] };
  it("accepts the contract body and strips queries from routes", () => {
    const d = parseDiagnostic(ok);
    expect(d?.events[0].route).toBe("/api/desktop/v1/notes/visits");
    expect(d?.events[0].detail).toBe("bad_time");
  });
  it("rejects unknown keys at either level", () => {
    expect(parseDiagnostic({ ...ok, patient: "x" })).toBeNull();
    expect(parseDiagnostic({ ...ok, events: [{ ts: "2026-11-06T12:00:00Z", kind: "api", body: "x" }] })).toBeNull();
  });
  it("drops detail text that looks like an email, URL or long number", () => {
    for (const detail of ["jane@x.com", "see https://a.b", "mrn 123456"]) {
      const d = parseDiagnostic({ ...ok, events: [{ ts: "2026-11-06T12:00:00Z", kind: "js", detail }] });
      expect(d?.events[0].detail).toBeUndefined();
    }
  });
  it("caps events and checks kinds", () => {
    expect(parseDiagnostic({ ...ok, events: Array(51).fill(ok.events[0]) })).toBeNull();
    expect(parseDiagnostic({ ...ok, events: [{ ts: "2026-11-06T12:00:00Z", kind: "other" }] })).toBeNull();
  });
});

describe("wiring", () => {
  it("update, download and diagnostics all require a signed-in user", () => {
    expect(readFileSync("src/app/api/desktop/v1/update/[target]/[version]/route.ts", "utf8")).toContain("authenticate(req)");
    expect(readFileSync("src/app/api/desktop/v1/diagnostics/route.ts", "utf8")).toContain("authenticate(req)");
    expect(readFileSync("src/app/downloads/desktop/route.ts", "utf8")).toContain("requireUser()");
    expect(readFileSync("src/app/download/page.tsx", "utf8")).toContain("requireUser()");
  });
  it("diagnostics admin page is admin only and has no write actions", () => {
    const p = readFileSync("src/app/admin/diagnostics/page.tsx", "utf8");
    expect(p).toContain("requireAdmin()");
    expect(p).not.toMatch(/"use server"|action=/);
  });
  it("diagnostics table is additive", () => expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/model DesktopDiagnostic/));
});

import { shouldShowUpdateBanner } from "@/lib/release";
describe("update banner rule", () => {
  const base = { latest: "1.0.6", reported: "1.0.5", dismissed: null, usesDesktop: true, hasNotes: true };
  it("shows when latest is newer", () => expect(shouldShowUpdateBanner(base)).toBe(true));
  it("hides when current or newer", () => {
    expect(shouldShowUpdateBanner({ ...base, reported: "1.0.6" })).toBe(false);
    expect(shouldShowUpdateBanner({ ...base, reported: "1.0.7" })).toBe(false);
  });
  it("hides after dismissing that version, shows again for a newer one", () => {
    expect(shouldShowUpdateBanner({ ...base, dismissed: "1.0.6" })).toBe(false);
    expect(shouldShowUpdateBanner({ ...base, latest: "1.0.7", dismissed: "1.0.6" })).toBe(true);
  });
  it("hides for people without desktop use or Notes access, and when nothing is published", () => {
    expect(shouldShowUpdateBanner({ ...base, usesDesktop: false })).toBe(false);
    expect(shouldShowUpdateBanner({ ...base, hasNotes: false })).toBe(false);
    expect(shouldShowUpdateBanner({ ...base, latest: null })).toBe(false);
  });
  it("is wired into the layout", () => expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("<DesktopUpdateBanner"));
});
