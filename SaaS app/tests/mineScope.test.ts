import { describe, expect, it } from "vitest";
import { mineName } from "../src/lib/notes/mineScope";
import { sameProvider } from "../src/lib/notes/suggestVisit";

describe("mineName", () => {
  it("no flag means everyone's visits", () => expect(mineName({ mine: null, myProviderName: null, userName: "Abdul Razak" })).toBeNull());
  it("mine=1 uses the account name", () => {
    expect(mineName({ mine: "1", myProviderName: null, userName: "Abdul Razak" })).toBe("Abdul Razak");
    expect(mineName({ mine: "0", myProviderName: null, userName: "Abdul Razak" })).toBeNull();
  });
  it("myProviderName wins and is trimmed", () => expect(mineName({ mine: "1", myProviderName: "  Dr. Chen ", userName: "Abdul Razak" })).toBe("Dr. Chen"));
  it("scopes a list by provider", () => {
    const rows = [{ p: "Dr. Razak" }, { p: "Dr. Chen" }, { p: "" }];
    expect(rows.filter((r) => sameProvider(r.p, "Abdul Razak"))).toEqual([{ p: "Dr. Razak" }]);
  });
});
