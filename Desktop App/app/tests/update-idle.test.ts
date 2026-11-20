import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canInstallNow } from "../src/lib/updates";

describe("self-update only when idle", () => {
  it("never installs while busy", () => { expect(canInstallNow(true)).toBe(false); expect(canInstallNow(false)).toBe(true); });
  it("busy means recording or saving, and the banner and the installer both honour it", () => {
    const app = readFileSync("src/App.tsx", "utf8"), banner = readFileSync("src/UpdateBanner.tsx", "utf8");
    expect(app).toMatch(/const busy = Object\.values\(rows\)\.some\(\(r\) => r\.phase === "recording" \|\| r\.phase === "working"\)/);
    expect(app).toContain("<UpdateBanner session={session} busy={busy}");
    expect((banner.match(/canInstallNow\(busy\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
