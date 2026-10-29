import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyToLine, fillForm, labelOf } from "../src/lib/formFill";
import { docxText } from "../src/lib/docxFill";

const FORMS = path.resolve(__dirname, "../../../Templates/forms");
const progress = () => readFileSync(path.join(FORMS, "Psychiatrist_Progress_Note_v1.docx"));

describe("applyToLine", () => {
  const line = "[ ] Good   [ ] Fair   [ ] Poor";
  it("ticks the chosen option and leaves the rest blank", () => {
    expect(applyToLine(line, { ticked: ["Fair"] }).text).toBe("[ ] Good   [X] Fair   [ ] Poor");
  });
  it("ticks several options", () => {
    expect(applyToLine(line, { ticked: ["Good", "Poor"] }).text).toBe("[X] Good   [ ] Fair   [X] Poor");
  });
  it("ignores case and spacing when matching an option", () => {
    expect(applyToLine(line, { ticked: ["  fair "] }).text).toContain("[X] Fair");
    expect(applyToLine("[ ] Not active   [ ] None", { ticked: ["not-active"] }).text).toContain("[X] Not active");
  });
  it("does not tick a neighbouring option by accident", () => {
    const out = applyToLine("[ ] None   [ ] Not active", { ticked: ["None"] }).text;
    expect(out).toBe("[X] None   [ ] Not active");
  });
  it("reports an option the form does not have, and changes nothing", () => {
    const r = applyToLine(line, { ticked: ["Excellent"] });
    expect(r.unknown).toEqual(["Excellent"]);
    expect(r.text).toBe(line);
  });
  it("writes free text into the blank", () => {
    expect(applyToLine("[ ] Yes   ____________", { ticked: ["Yes"], text: "sertraline 50 mg" }).text)
      .toBe("[X] Yes   sertraline 50 mg");
  });
  it("appends free text when the line has no blank", () => {
    expect(applyToLine("[ ] Yes", { text: "note" }).text).toBe("[ ] Yes note");
  });
  it("leaves a line untouched when nothing is asked for", () => {
    expect(applyToLine(line, {}).text).toBe(line);
  });
});

describe("labelOf", () => {
  it("takes the text before a colon or the first checkbox", () => {
    expect(labelOf("Physical complaints:  [ ] None")).toBe("Physical complaints");
    expect(labelOf("[ ] Good   [ ] Fair")).toBe("");
    expect(labelOf("Brief description of event ______")).toBe("Brief description of event");
  });
});

describe("fillForm on the practice's progress note", () => {
  it("ticks boxes in the interval history and mental status tables", async () => {
    const r = await fillForm(progress(), {
      "*Sleep": { ticked: ["Poor"] },
      Appetite: { ticked: ["Fair"] },
      Depression: { ticked: ["Present"] },
      "Suicidal ideation": { ticked: ["None"] },
      Mood: { text: "I feel low" },
    });
    expect(r.unknownFields).toEqual([]);
    expect(r.unknownOptions).toEqual([]);
    const text = await docxText(r.bytes);
    expect(text).toContain("[X] Poor");
    expect(text).toContain("[X] Fair");
    expect(text).toMatch(/Suicidal ideation[\s\S]{0,40}\[X\] None/);
    expect(text).toContain("I feel low");
  });

  it("fills a labelled paragraph field", async () => {
    const r = await fillForm(progress(), {
      "Physical complaints": { ticked: ["None"] },
      "Working Diagnosis (required)": { text: "F33.1 MDD recurrent, moderate" },
    });
    const text = await docxText(r.bytes);
    expect(text).toContain("[X] None");
    expect(text).toContain("F33.1 MDD recurrent, moderate");
  });

  it("leaves every other box blank, because blank means not assessed", async () => {
    const before = (await docxText(progress())).match(/\[ \]/g)!.length;
    const r = await fillForm(progress(), { "*Sleep": { ticked: ["Poor"] } });
    const after = (await docxText(r.bytes)).match(/\[ \]/g)!.length;
    expect(before - after).toBe(1);
  });

  it("reports fields and options the form does not have instead of failing", async () => {
    const r = await fillForm(progress(), {
      "No Such Field": { ticked: ["Whatever"] },
      "*Sleep": { ticked: ["Excellent"] },
    });
    expect(r.unknownFields).toContain("No Such Field");
    expect(r.unknownOptions).toEqual([{ field: "*Sleep", option: "Excellent" }]);
  });

  it("produces a file macOS still reads as a Word document", async () => {
    const r = await fillForm(progress(), { "*Sleep": { ticked: ["Good"] } });
    expect(r.bytes.length).toBeGreaterThan(10_000);
    expect(await docxText(r.bytes)).toContain("Psychiatrist Progress Note");
  });
});
