import { describe, expect, it } from "vitest";
import { ENV_TEXT, envKind, titlePrefix } from "../src/lib/envBanner";

describe("envKind", () => {
  it("staging, development, and everything else is production", () => {
    expect(envKind({ APP_ENV: "staging" })).toBe("staging");
    expect(envKind({ APP_ENV: "development" })).toBe("development");
    expect(envKind({ APP_ENV: "production" })).toBe("production");
    expect(envKind({})).toBe("production");
    expect(envKind({ APP_ENV: "Staging " })).toBe("production");
  });
  it("every kind has a label and note; only non-production tabs get a title prefix", () => {
    for (const k of ["staging", "development", "production"] as const) { expect(ENV_TEXT[k].label).toBeTruthy(); expect(ENV_TEXT[k].note).toBeTruthy(); }
    expect(titlePrefix("staging")).toBe("[STAGING] ");
    expect(titlePrefix("production")).toBe("");
  });
});
