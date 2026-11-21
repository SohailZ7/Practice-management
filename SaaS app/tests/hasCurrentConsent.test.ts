import { describe, it, expect } from "vitest";
import { hasCurrentConsent, RECORDING_CONSENT } from "../src/lib/consent/consentText";

const V = RECORDING_CONSENT.version;
describe("hasCurrentConsent", () => {
  it("is true only for a given confirmation on the current wording", () => {
    expect(hasCurrentConsent([{ given: true, textVersion: V }])).toBe(true);
    expect(hasCurrentConsent([{ given: false, textVersion: "old" }, { given: true, textVersion: V }])).toBe(true);
  });
  it("is false for none, declined, older wording or bad data", () => {
    expect(hasCurrentConsent([])).toBe(false);
    expect(hasCurrentConsent(undefined)).toBe(false);
    expect(hasCurrentConsent([{ given: false, textVersion: V }])).toBe(false);
    expect(hasCurrentConsent([{ given: true, textVersion: "2026-11-01-draft-1" }])).toBe(false);
    expect(hasCurrentConsent([{}])).toBe(false);
  });
});
