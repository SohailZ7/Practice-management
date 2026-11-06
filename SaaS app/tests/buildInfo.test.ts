import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { environmentLabel, latestWebRelease, webRelease } from "@/lib/buildInfo";

describe("build info", () => {
  it("takes the highest Web 1.N from the list, ignoring hashes", () => {
    expect(latestWebRelease("# x\nWeb 1.2 | a | abc\nWeb 1.10 | b | def\nWeb 1.9 | c | 123")).toBe("Web 1.10");
    expect(latestWebRelease("")).toBe("");
  });
  it("the real release list parses", () => expect(webRelease({})).toMatch(/^Web 1\.\d+$/));
  it("WEB_RELEASE overrides, but only in the plain format", () => {
    expect(webRelease({ WEB_RELEASE: "Web 1.77" })).toBe("Web 1.77");
    expect(webRelease({ WEB_RELEASE: "abc1234" })).toMatch(/^Web 1\.\d+$/);
  });
  it("labels the environment", () => {
    expect(environmentLabel({ APP_ENV: "staging" })).toBe("STAGING");
    expect(environmentLabel({ APP_ENV: "production" })).toBe("PRODUCTION");
    expect(environmentLabel({})).toBe("DEVELOPMENT");
  });
  it("settings page shows both and no longer says paste the token", () => {
    const s = readFileSync("src/app/settings/page.tsx", "utf8");
    expect(s).toContain("webRelease()");
    expect(s).toContain("environmentLabel()");
    expect(s).toContain('href="/download"');
    expect(s).not.toContain("paste the token");
    expect(s.toLowerCase()).toContain("sign in with");
  });
});
