import { describe, expect, it } from "vitest";
import { micWarning } from "../src/lib/micHealth";

describe("microphone unplugged or blocked during a visit", () => {
  it("a healthy microphone shows nothing", () => {
    expect(micWarning({ lost: false, silent: false })).toBeNull();
    expect(micWarning(null)).toBeNull();
  });
  it("a lost stream says so and reassures that the words so far are saved", () => {
    const w = micWarning({ lost: true, silent: false })!;
    expect(w).toContain("disconnected or was blocked");
    expect(w).toContain("saved on this Mac");
  });
  it("ten seconds of silence tells the provider to check the mic", () => {
    expect(micWarning({ lost: false, silent: true })).toContain("No sound from the microphone");
  });
  it("lost wins over silent, and the text never carries patient information", () => {
    expect(micWarning({ lost: true, silent: true })).toContain("disconnected");
  });
});
