import { describe, expect, it } from "vitest";
import { hasSpeakers, parseTurns, speakerRole } from "@/lib/transcript/turns";

describe("parseTurns (fake text only)", () => {
  it("groups consecutive lines from the same speaker", () => {
    const t = parseTurns("[00:03] Provider: Hello.\n[00:05] Provider: How are you?\n[00:09] Patient: Fine.");
    expect(t).toEqual([
      { time: "00:03", seconds: 3, speaker: "Provider", text: "Hello. How are you?" },
      { time: "00:09", seconds: 9, speaker: "Patient", text: "Fine." },
    ]);
    expect(hasSpeakers(t)).toBe(true);
  });
  it("keeps plain and older text as unlabelled blocks", () => {
    const t = parseTurns("Just some text\n\n[01:02] no speaker here");
    expect(t.map((x) => x.speaker)).toEqual(["", ""]);
    expect(t[0].text).toBe("Just some text");
    expect(hasSpeakers(t)).toBe(false);
  });
  it("maps roles", () => {
    expect(speakerRole("Provider")).toBe("provider");
    expect(speakerRole("Patient 2")).toBe("patient");
    expect(speakerRole("Speaker 1")).toBe("other");
  });
});
