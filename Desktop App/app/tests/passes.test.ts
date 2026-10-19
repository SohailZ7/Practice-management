import { describe, expect, it } from "vitest";
import { applyVerdicts, askRiskQuestion, parseAnswer, parseVerdicts, quoteInSource, verifyParas } from "../src/lib/passes";
import { draftNote } from "../src/lib/pipeline";
import { NOT_DISCUSSED } from "../src/lib/sectionMap";
import type { Llm, Para } from "../src/lib/types";

const SOURCE = "Doctor, any thoughts of hurting yourself? Patient, no, I deny any thoughts of suicide. My sister tried to kill herself with pills when I was in high school.";

describe("quoteInSource", () => {
  it("accepts exact, punctuation-different and slightly reworded quotes", () => {
    expect(quoteInSource("I deny any thoughts of suicide", SOURCE)).toBe(true);
    expect(quoteInSource("no, I deny any thoughts of suicide.", SOURCE)).toBe(true);
    expect(quoteInSource("I deny having any thoughts of suicide", SOURCE)).toBe(true);
  });
  it("rejects quotes that are not in the source, and empty ones", () => {
    expect(quoteInSource("the patient attempted suicide in 2018", SOURCE)).toBe(false);
    expect(quoteInSource("", SOURCE)).toBe(false);
    expect(quoteInSource("hurting", SOURCE)).toBe(false);
  });
});

describe("parseAnswer", () => {
  it("reads the three lines, with markdown noise", () => {
    expect(parseAnswer("**ANSWER:** NO\nSTATEMENT: The patient denies suicidal thoughts.\nQUOTE: \"I deny any thoughts of suicide\"")).toEqual({
      answer: "NO", statement: "The patient denies suicidal thoughts.", quote: "I deny any thoughts of suicide",
    });
    expect(parseAnswer("ANSWER: not asked\nSTATEMENT:\nQUOTE:").answer).toBe("NOT_ASKED");
    expect(parseAnswer("no idea").answer).toBe("UNPARSED");
  });
});

const scripted = (reply: string): Llm => async () => reply;

describe("askRiskQuestion", () => {
  it("records a denial with its quote", async () => {
    const p = await askRiskQuestion(scripted("ANSWER: NO\nSTATEMENT: The patient denies thoughts of suicide.\nQUOTE: I deny any thoughts of suicide"), SOURCE, "Suicidal thoughts", "q");
    expect(p).toMatchObject({ label: "Suicidal thoughts", text: "The patient denies thoughts of suicide.", evidence: "I deny any thoughts of suicide" });
    expect(p.flag).toBeUndefined();
  });
  it("keeps not-asked as not discussed", async () => {
    const p = await askRiskQuestion(scripted("ANSWER: NOT_ASKED\nSTATEMENT:\nQUOTE:"), SOURCE, "Protective factors", "q");
    expect(p).toEqual({ label: "Protective factors", text: NOT_DISCUSSED, flag: "not_discussed" });
  });
  it("never turns a missing protective factor or safety plan into a statement", async () => {
    for (const label of ["Protective factors", "Safety plan discussed"]) {
      const p = await askRiskQuestion(scripted("ANSWER: NO\nSTATEMENT: The patient does not report any reasons for living.\nQUOTE: no"), SOURCE, label, "q");
      expect(p).toEqual({ label, text: NOT_DISCUSSED, flag: "not_discussed" });
    }
  });
  it("treats 'does not report ...' as an absence, not a denial", async () => {
    const p = await askRiskQuestion(scripted("ANSWER: NO\nSTATEMENT: The patient does not express any desire to be dead.\nQUOTE: I feel sad"), SOURCE, "Wish to be dead", "q");
    expect(p).toEqual({ label: "Wish to be dead", text: NOT_DISCUSSED, flag: "not_discussed" });
    const denial = await askRiskQuestion(scripted("ANSWER: NO\nSTATEMENT: The patient denies thoughts of suicide.\nQUOTE: I deny any thoughts of suicide"), SOURCE, "Wish to be dead", "q");
    expect(denial.text).toBe("The patient denies thoughts of suicide.");
  });
  it("flags an answer whose quote is not in the transcript", async () => {
    const p = await askRiskQuestion(scripted("ANSWER: YES\nSTATEMENT: The patient attempted suicide in 2018.\nQUOTE: I took a bottle of pills in 2018"), SOURCE, "Suicidal behavior", "q");
    expect(p.flag).toBe("ungrounded");
  });
  it("keeps an unparseable reply but asks the provider to confirm it", async () => {
    const p = await askRiskQuestion(scripted("The patient seems fine"), SOURCE, "Wish to be dead", "q");
    expect(p.flag).toBe("confirm");
  });
});

describe("verification verdicts", () => {
  const paras: Para[] = [
    { label: "Prior suicide attempts / self-harm", text: "The patient reports a sister attempted suicide with pills." },
    { label: "Prior medications and response", text: "Xanax 10 milligrams for two weeks." },
    { label: "Prior therapy", text: "The patient reports eight sessions of therapy." },
    { label: "Diagnoses", text: NOT_DISCUSSED, flag: "not_discussed" },
  ];
  it("parses verdict lines", () => {
    const v = parseVerdicts("1 | SUPPORTED | ABOUT: FAMILY | SAID_BY: PATIENT | QUOTE: My sister tried to kill herself with pills\n2. UNSUPPORTED | ABOUT: PATIENT | SAID_BY: UNCLEAR | QUOTE:\nnoise");
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ n: 1, supported: true, about: "FAMILY", saidBy: "PATIENT" });
    expect(v[1]).toMatchObject({ n: 2, supported: false });
  });
  it("removes a relative's attempt from a patient-history section, and shows what was removed", () => {
    const out = applyVerdicts(paras, parseVerdicts("1 | SUPPORTED | ABOUT: FAMILY | SAID_BY: PATIENT | QUOTE: My sister tried to kill herself with pills"), SOURCE, true);
    expect(out[0]).toMatchObject({ text: NOT_DISCUSSED, flag: "removed" });
    expect(out[0].removed?.reason).toMatch(/someone other than the patient/);
    expect(out[0].removed?.text).toContain("sister");
  });
  it("keeps a family fact in a section that allows it", () => {
    const out = applyVerdicts(paras.slice(0, 1), parseVerdicts("1 | SUPPORTED | ABOUT: FAMILY | SAID_BY: PATIENT | QUOTE: My sister tried to kill herself with pills"), SOURCE, false);
    expect(out[0].flag).toBeUndefined();
  });
  it("removes an unsupported sentence (an invented dose); a quote that cannot be found only flags the line", () => {
    const out = applyVerdicts(paras, parseVerdicts("2 | UNSUPPORTED | ABOUT: PATIENT | SAID_BY: UNCLEAR | QUOTE:\n3 | SUPPORTED | ABOUT: PATIENT | SAID_BY: PATIENT | QUOTE: eight sessions of therapy two years ago"), SOURCE, true);
    expect(out[1]).toMatchObject({ flag: "removed", text: NOT_DISCUSSED });
    expect(out[2].flag).toBe("ungrounded");
    expect(out[2].text).toBe("The patient reports eight sessions of therapy.");
  });
  it("does not call 'two milligrams' unsupported when the note says 2: the verifier sees numbers as digits too", async () => {
    const seen: string[] = [];
    await verifyParas(async (r) => { seen.push(r.prompt); return ""; }, "we increased prazosin to two milligrams", [{ label: "a", text: "Prazosin 2 milligrams." }], true);
    expect(seen[0]).toContain("two 2 milligrams");
  });
  it("leaves lines without a verdict and not-discussed lines alone", () => {
    const out = applyVerdicts(paras, [], SOURCE, true);
    expect(out).toEqual(paras);
  });
  it("relabels a collateral report that was written as the patient's", () => {
    const p: Para[] = [{ text: "The patient reports spending a lot of money and buying a used truck." }];
    const src = "Spouse, he bought a used truck and has been spending a lot of money.";
    const out = applyVerdicts(p, parseVerdicts("1 | SUPPORTED | ABOUT: PATIENT | SAID_BY: OTHER | QUOTE: he bought a used truck and has been spending a lot of money"), src, true);
    expect(out[0].text.startsWith("Another person present reports")).toBe(true);
  });
  it("asks the provider to confirm when the doctor's proposal is written as the patient's request", () => {
    const p: Para[] = [{ text: "The patient requests an increase to 100 milligrams." }];
    const out = applyVerdicts(p, parseVerdicts("1 | SUPPORTED | ABOUT: DOCTOR_PLAN | SAID_BY: DOCTOR | QUOTE: I would like to increase it to one hundred milligrams"), "Doctor, I would like to increase it to one hundred milligrams.", false);
    expect(out[0].flag).toBe("confirm");
  });
  it("verifyParas sends one call per section and numbers the sentences", async () => {
    const calls: string[] = [];
    const llm: Llm = async (r) => { calls.push(r.prompt); return "1 | SUPPORTED | ABOUT: PATIENT | SAID_BY: PATIENT | QUOTE: I deny any thoughts of suicide"; };
    await verifyParas(llm, SOURCE, [{ label: "a", text: "The patient denies suicidal thoughts." }], true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("1. a: The patient denies suicidal thoughts.");
  });
});

describe("draftNote with the passes", () => {
  const base = { kind: "EVAL" as const, transcript: SOURCE, mode: "recording" as const, visitDate: "2026-10-19", typeLabel: "Psych Eval", providerName: "Dr. Example", patientName: "Testcase, Alpha" };
  it("asks six suicide-risk questions and records the denial instead of 'not discussed'", async () => {
    const llm: Llm = async ({ system, prompt }) => {
      if (system.includes("answer one question")) {
        return prompt.includes("thoughts of killing themselves") ? "ANSWER: NO\nSTATEMENT: The patient denies suicidal thoughts.\nQUOTE: I deny any thoughts of suicide" : "ANSWER: NOT_ASKED\nSTATEMENT:\nQUOTE:";
      }
      return "";
    };
    const note = await draftNote({ ...base, llm });
    const ssrs = note.sections.find((s) => s.heading.startsWith("6."))!;
    expect(ssrs.paragraphs).toHaveLength(6);
    expect(ssrs.paragraphs.find((p) => p.label === "Suicidal thoughts")!.text).toBe("The patient denies suicidal thoughts.");
    expect(ssrs.paragraphs.filter((p) => p.flag === "not_discussed")).toHaveLength(5);
    expect(ssrs.mustConfirm).toBe(true);
  });
  it("can be switched off, to measure what the passes add", async () => {
    const systems: string[] = [];
    await draftNote({ ...base, passes: { ssrs: false, verify: false }, llm: async (r) => { systems.push(r.system); return ""; } });
    expect(systems.every((s) => s.includes("You write one section"))).toBe(true);
  });
});
