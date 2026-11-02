import { describe, expect, it } from "vitest";
import { ADMIT_ORDER_FIELDS, DISCHARGE_ORDER_FIELDS, draftForm, FORM_SYSTEM, parseFormAnswer, PROGRESS_NOTE_FIELDS, type FieldSpec } from "../src/lib/notes/formSpec";
import { fieldsFor } from "../src/lib/notes/generate";



describe("parseFormAnswer", () => {
  it("reads the two lines", () => {
    expect(parseFormAnswer("CHOOSE: Poor\nTEXT: The patient reports five hours a night.")).toEqual({
      ticked: ["Poor"], text: "The patient reports five hours a night.",
    });
  });
  it("splits several options and tolerates markdown", () => {
    expect(parseFormAnswer("**CHOOSE:** Nausea; Tremor\nTEXT: NONE").ticked).toEqual(["Nausea", "Tremor"]);
  });
  it("treats NONE, blank and a missing line as nothing chosen", () => {
    for (const raw of ["CHOOSE: NONE\nTEXT: NONE", "CHOOSE:\nTEXT:", "nothing useful"]) {
      expect(parseFormAnswer(raw)).toEqual({ ticked: [], text: undefined });
    }
  });
  it("keeps 'None' when the form offers it as an answer, so a denial is not lost", () => {
    // On the suicidal ideation line "None" means the patient denied it, which must be recorded.
    expect(parseFormAnswer("CHOOSE: None\nTEXT: NONE", ["None", "Not active", "Thoughts"]).ticked).toEqual(["None"]);
    expect(parseFormAnswer("CHOOSE: None\nTEXT: NONE", ["Good", "Fair", "Poor"]).ticked).toEqual([]);
  });
  it("strips reasoning tokens first", () => {
    expect(parseFormAnswer("<think>hmm</think>CHOOSE: Good\nTEXT: NONE").ticked).toEqual(["Good"]);
  });
});

describe("draftForm", () => {
  const fields = PROGRESS_NOTE_FIELDS.slice(0, 4);
  it("asks one question per field and never sends the patient's name", async () => {
    const prompts: string[] = [];
    await draftForm(async (r) => { prompts.push(r.system + r.prompt); return "CHOOSE: NONE\nTEXT: NONE"; }, fields, "the transcript");
    expect(prompts).toHaveLength(fields.length);
    for (const p of prompts) expect(p).toContain(FORM_SYSTEM);
  });
  it("leaves unanswered fields blank and lists them", async () => {
    const d = await draftForm(async () => "CHOOSE: NONE\nTEXT: NONE", fields, "t");
    expect(d.values).toEqual({});
    expect(d.blank).toHaveLength(fields.length);
  });
  it("records ticks and text, and always flags the risk fields", async () => {
    const d = await draftForm(async ({ prompt }) =>
      prompt.includes("*Sleep") ? "CHOOSE: Poor\nTEXT: NONE" : "CHOOSE: NONE\nTEXT: NONE", PROGRESS_NOTE_FIELDS, "t");
    expect(d.values["*Sleep"]).toEqual({ ticked: ["Poor"] });
    expect(d.needsAttention).toContain("Suicidal ideation");
    expect(d.needsAttention).toContain("Homicidal ideation");
  });
  it("drops a tick for a field that has no options, and text for a field that takes none", async () => {
    const d = await draftForm(async () => "CHOOSE: Poor\nTEXT: a phrase", PROGRESS_NOTE_FIELDS, "t");
    expect(d.values["Working Diagnosis (required)"]).toEqual({ text: "a phrase" }); // text-only field
    expect(d.values["Energy"]).toEqual({ ticked: ["Poor"] });                        // options-only field
  });
});

// This is the check that would have caught the orders being wired to the progress note's questions: every question
// must name a field that exists on its own form, and every option must exist on that field's line.
