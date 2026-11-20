import { describe, expect, it } from "vitest";
import { micCheckMessage } from "../src/App";
describe("mic check line", () => {
  it("a silent mic is called out after 5 seconds and never says it hears you", () => {
    expect(micCheckMessage(false, 2)).toMatch(/Say a few words/);
    expect(micCheckMessage(false, 5)).toMatch(/No sound yet/);
    expect(micCheckMessage(false, 600)).not.toMatch(/picking up/);
  });
  it("says so once sound was heard", () => { expect(micCheckMessage(true, 1)).toMatch(/picking up your voice/); });
});
