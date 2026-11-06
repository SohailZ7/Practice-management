import { describe, expect, it } from "vitest";
import { bucketize, firstWords, hasUnconfirmed, parseTranscript, patientChoice, relabelText, speakersIn } from "../src/lib/transcriptView";

// Fake transcripts only.
const TEXT = [
  "[00:00] Provider: Good morning, how have you been sleeping?",
  "[00:07] Patient: Not great. I wake up a lot.",
  "[00:15] Patient: Maybe four hours.",
  "[05:20] Provider: Let us talk about the dose.",
].join("\n");

describe("transcript view", () => {
  it("reads blocks with time and speaker and joins consecutive lines of one speaker", () => {
    const b = parseTranscript(TEXT);
    expect(b.map((x) => [x.time, x.speaker])).toEqual([["00:00", "Provider"], ["00:07", "Patient"], ["05:20", "Provider"]]);
    expect(b[1].text).toBe("Not great. I wake up a lot. Maybe four hours.");
    expect(speakersIn(b)).toEqual(["Provider", "Patient"]);
  });

  it("keeps plain old transcripts and separator lines instead of dropping them", () => {
    const b = parseTranscript("Just words with no times.\n\n--- Added 3:10 pm ---\n[00:02] Speaker 1: Hello.");
    expect(b.map((x) => x.text)).toEqual(["Just words with no times.", "--- Added 3:10 pm ---", "Hello."]);
    expect(b[0].time).toBe("");
    expect(hasUnconfirmed(b)).toBe(true);
  });

  it("splits long recordings into five-minute buckets with headings and leaves short ones alone", () => {
    const buckets = bucketize(parseTranscript(TEXT));
    expect(buckets.map((x) => x.heading)).toEqual(["00:00 – 05:00", "05:00 – 10:00"]);
    expect(buckets[0].blocks.length).toBe(2);
    expect(bucketize(parseTranscript("[00:01] Provider: Hi.\n[01:10] Patient: Hello."))).toEqual([
      { heading: "", blocks: expect.any(Array) },
    ]);
    expect(bucketize([])).toEqual([]);
  });

  it("renames speakers only at the start of timed lines, and swaps cleanly", () => {
    const swapped = relabelText(TEXT, { Provider: "Patient", Patient: "Provider" });
    expect(swapped.split("\n")[0]).toBe("[00:00] Patient: Good morning, how have you been sleeping?");
    expect(swapped.split("\n")[1]).toBe("[00:07] Provider: Not great. I wake up a lot.");
    const text = "[00:00] Speaker 1: I am Speaker 1: not a label here.";
    expect(relabelText(text, { "Speaker 1": "Patient" })).toBe("[00:00] Patient: I am Speaker 1: not a label here.");
    expect(relabelText("no times here", { "Speaker 1": "Patient" })).toBe("no times here");
  });

  it("builds the patient choice and the sample words", () => {
    expect(patientChoice("Speaker 2", ["Speaker 1", "Speaker 2"])).toEqual({ "Speaker 1": "Provider", "Speaker 2": "Patient" });
    const b = parseTranscript("[00:00] Speaker 1: one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen");
    expect(firstWords(b, "Speaker 1")).toBe("one two three four five six seven eight nine ten eleven twelve thirteen fourteen");
    expect(firstWords(b, "Speaker 2")).toBe("");
  });
});
