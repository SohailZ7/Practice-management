import { describe, expect, it } from "vitest";
import { scopeToken, tokenFor } from "../src/lib/tokenScope";

describe("token scope", () => {
  it("hands the token out only for the environment it was issued for", () => {
    const t = scopeToken("staging", "stg-token");
    expect(tokenFor(t, "staging")).toBe("stg-token");
    expect(tokenFor(t, "production")).toBeNull();
    expect(tokenFor(t, "localhost")).toBeNull();
  });
  it("gives nothing when there is no token", () => {
    expect(scopeToken("staging", null)).toBeNull();
    expect(tokenFor(null, "staging")).toBeNull();
  });
});
