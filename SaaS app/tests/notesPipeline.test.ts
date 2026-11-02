import { describe, expect, it } from "vitest";
import { noteFileName, patientFolderName, safePart } from "../src/lib/notes/patientFolder";
import { ungroundedTerms, wordsToNumber } from "../src/lib/notes/grounding";
import { buildPrompt, draftNote, flagParas, isNotDiscussed, parseSection, SYSTEM_RULES, type DraftInput } from "../src/lib/notes/pipeline";
import { NOT_DISCUSSED, PLANS } from "../src/lib/notes/sectionMap";
import { QUESTION_SYSTEM, VERIFY_SYSTEM } from "../src/lib/notes/passes";
import type { Llm } from "../src/lib/notes/types";


describe("patient folder and file names", () => {
  it("uses Last, First and strips characters a file system rejects", () => {
    expect(patientFolderName("Testcase", "Alpha")).toBe("Testcase, Alpha");
    expect(patientFolderName("O'Neil/..", "Jo:hn")).toBe("O'Neil .., Jo hn");
    expect(patientFolderName("", "  ")).toBe("Unknown, Unknown");
    expect(safePart("..hidden")).toBe("hidden");
  });
  it("puts the patient's name first and marks the file as a draft", () => {
    expect(noteFileName("2026-10-29", "Follow-up", () => false, "Testcase, Alpha "))
      .toBe("Testcase, Alpha 2026-10-29 Follow-up DRAFT.docx");
    expect(noteFileName("2026-10-29", "Psych Eval", () => false, "", false)).toBe("2026-10-29 Psych Eval.docx");
  });
  it("adds (2) when a document for that date and type already exists", () => {
    const taken = new Set(["2026-10-19 Follow-up DRAFT.docx", "2026-10-19 Follow-up DRAFT (2).docx"]);
    expect(noteFileName("2026-10-19", "Follow-up", (n) => taken.has(n))).toBe("2026-10-19 Follow-up DRAFT (3).docx");
  });
});

describe("grounding (NOT-5)", () => {
  const source = "The patient says she has slept about two hours a night for 3 weeks. She takes sertraline.";
  it("accepts numbers and names found in the source, including spelled-out numbers", () => {
    expect(ungroundedTerms("She reports sleeping 2 hours a night for 3 weeks. She takes Sertraline.", source)).toEqual([]);
  });
  it("understands spelled-out numbers beyond ten, such as fifty and one hundred", () => {
    const src = "I take sertraline fifty milligrams. The doctor would increase it to one hundred milligrams. I am thirty-two. About twenty five pounds.";
    expect(ungroundedTerms("Sertraline 50 mg, increase to 100 mg. Age 32. Lost 25 pounds.", src)).toEqual([]);
    expect(ungroundedTerms("Sertraline 150 mg.", src)).toContain("150");
    expect(wordsToNumber(["two", "hundred", "fifty"])).toBe(250);
  });
  it("flags a dose or a medication that was never said", () => {
    const bad = ungroundedTerms("She takes sertraline 150 mg and Lithium.", source);
    expect(bad).toContain("150");
    expect(bad).toContain("Lithium");
  });
});

describe("parseSection", () => {
  const labels = ["Primary reason for treatment", "Functional impact"];
  it("reads labeled lines, bullets and wrapped lines", () => {
    const out = parseSection("- **Primary reason for treatment**: Low mood\nand poor sleep.\nFunctional impact: Missed work.", labels);
    expect(out).toEqual([
      { label: "Primary reason for treatment", text: "Low mood and poor sleep." },
      { label: "Functional impact", text: "Missed work." },
    ]);
  });
  it("fills missing labels with the not-discussed sentence", () => {
    const out = parseSection("Functional impact: Missed work.", labels);
    expect(out[0]).toEqual({ label: labels[0], text: NOT_DISCUSSED });
  });
  it("splits label-less output into paragraphs", () => {
    expect(parseSection("One.\n\nTwo.", []).map((p) => p.text)).toEqual(["One.", "Two."]);
  });
  it("treats reworded not-discussed lines the same, and drops a stray one next to real content", () => {
    expect(isNotDiscussed("Not discussed in recording.")).toBe(true);
    expect(isNotDiscussed("Not stated.")).toBe(true);
    expect(isNotDiscussed("Not discussed in this recording.")).toBe(true);
    expect(isNotDiscussed("Patient did not discuss anything unusual.")).toBe(false);
    expect(parseSection("Real content.\n\nNot discussed in this recording.", []).map((p) => p.text)).toEqual(["Real content."]);
    expect(parseSection("Not discussed in recording.", labels)[0].text).toBe(NOT_DISCUSSED);
  });
  it("drops heading lines the model adds to label-less sections", () => {
    expect(parseSection("Depression:\nThe patient reports low mood.\n\nSleep:\nThe patient sleeps five hours.", []).map((p) => p.text)).toEqual([
      "The patient reports low mood.",
      "The patient sleeps five hours.",
    ]);
  });
  it("tells the model to record denials and to paraphrase", () => {
    expect(SYSTEM_RULES).toMatch(/denial or a "none" is a statement/);
    expect(SYSTEM_RULES).toMatch(/Do not copy the patient's first-person words/);
  });
  it("tells the model to attribute statements to the right speaker", () => {
    expect(SYSTEM_RULES).toMatch(/Attribute each statement/);
    expect(SYSTEM_RULES).toMatch(/Never say the patient requested/);
  });
  it("flags not-discussed and ungrounded lines", () => {
    const flagged = flagParas([{ label: "a", text: NOT_DISCUSSED }, { label: "b", text: "Takes 300 mg" }, { label: "c", text: "Slept poorly" }], "slept poorly");
    expect(flagged.map((p) => p.flag)).toEqual(["not_discussed", "ungrounded", undefined]);
  });
});

const fakeLlm: Llm = async ({ prompt }) => {
  if (prompt.includes("SECTION: Chief Complaint")) return "Patient's words: I can't sleep and I feel low.";
  if (prompt.includes("SECTION: Suicide Risk")) return "Wish to be dead: The patient denies.\nSuicidal thoughts: The patient denies.";
  if (prompt.includes("SECTION: Medication")) return "Medication action: Start\nMedication and dose: Sertraline 150 mg";
  return "";
};

const base = (over: Partial<DraftInput> = {}): DraftInput => ({
  kind: "EVAL",
  transcript: "Doctor: What brings you in? Patient: I can't sleep and I feel low. I deny wanting to die.",
  mode: "recording",
  visitDate: "2026-10-19",
  typeLabel: "Psych Eval",
  providerName: "Dr. Example",
  patientName: "Testcase, Alpha",
  llm: fakeLlm,
  ...over,
});

describe("draftNote", () => {
  it("never sends the patient's name to the model, and every prompt carries safety rules", async () => {
    const prompts: string[] = [];
    await draftNote(base({ llm: async (r) => { prompts.push(r.system + r.prompt); return ""; } }));
    expect(prompts.length).toBeGreaterThan(5);
    for (const p of prompts) {
      expect(p).not.toContain("Testcase");
      expect(p.includes(SYSTEM_RULES) || p.includes(QUESTION_SYSTEM) || p.includes(VERIFY_SYSTEM)).toBe(true);
    }
  });
  it("marks empty model output as not discussed, flags an invented dose, and requires confirmation on risk sections", async () => {
    const note = await draftNote(base());
    const cc = note.sections.find((s) => s.heading.startsWith("2."))!;
    expect(cc.paragraphs[0].flag).toBeUndefined();
    const hpi = note.sections.find((s) => s.heading.startsWith("3."))!;
    expect(hpi.paragraphs.every((p) => p.flag === "not_discussed")).toBe(true);
    const med = note.sections.find((s) => s.heading.startsWith("17."))!;
    expect(med.mustConfirm).toBe(true);
    expect(med.paragraphs[1].flag).toBe("ungrounded"); // "Sertraline 150 mg" is not in the transcript
    expect(note.sections.find((s) => s.heading.startsWith("6."))!.mustConfirm).toBe(true);
  });
  it("uses the prior note only for follow-ups and discharges, and records where it came from", async () => {
    const seen: string[] = [];
    const prior = { fileName: "2026-10-12 Psych Eval.docx", text: "PRIOR-NOTE-TEXT" };
    const fu = await draftNote(base({ kind: "FOLLOW_UP", priorNote: prior, llm: async (r) => { seen.push(r.prompt); return ""; } }));
    expect(seen.some((p) => p.includes("PRIOR-NOTE-TEXT"))).toBe(true);
    expect(fu.sections[0].paragraphs.some((p) => p.text === prior.fileName)).toBe(true);
    seen.length = 0;
    await draftNote(base({ priorNote: prior, llm: async (r) => { seen.push(r.prompt); return ""; } }));
    expect(seen.some((p) => p.includes("PRIOR-NOTE-TEXT"))).toBe(false);
  });
  it("tells the model when the input is a dictated summary", async () => {
    const seen: string[] = [];
    await draftNote(base({ mode: "dictation", llm: async (r) => { seen.push(r.prompt); return ""; } }));
    expect(seen[0]).toContain("dictated summary");
  });
  it("builds a prompt that lists the labels and the not-discussed rule", () => {
    const spec = PLANS.EVAL.sections.find((s) => s.heading.startsWith("2."))!;
    const p = buildPrompt(base(), spec, "Chief Complaint");
    expect(p).toContain("Patient's words");
    expect(p).toContain(NOT_DISCUSSED);
  });
});

