import { describe, expect, it } from "vitest";
import { DRAFT_LINE, formToMarkdown, isDraft, noteToMarkdown } from "../src/lib/notes/markdown";
import { markdownToHtml, markdownToPrintableHtml } from "../src/lib/notes/pdf";
import { PROGRESS_NOTE_FIELDS } from "../src/lib/notes/formSpec";
import { documentsFor } from "../src/lib/notes/documents";
import { patientInitials } from "../src/lib/notes/patientFolder";
import type { DraftNote } from "../src/lib/notes/types";

const header = { patient: "Testcase, Alpha", visitDate: "2026-11-01", visitType: "Follow-up", provider: "Dr. Example" };

const note: DraftNote = {
  kind: "FOLLOW_UP",
  title: "Psychiatric Progress Note",
  sections: [
    { heading: "19. Progress Note Carry-Forward Block", action: "fill", mustConfirm: true, paragraphs: [
      { label: "Interval clinical status", text: "The patient reports better sleep." },
      { label: "Current symptoms", text: "Not discussed in this recording.", flag: "not_discussed" },
      { label: "Risk", text: "Sertraline 150 mg", flag: "ungrounded" },
      { label: "Plan", text: "", flag: "removed", removed: { text: "The sister attempted suicide.", reason: "about someone other than the patient" } },
    ] },
    { heading: "12. Mental Status Examination", action: "keep", paragraphs: [{ text: "Not assessed in this recording.", flag: "not_assessed" }] },
    { heading: "20. Discharge Summary Carry-Forward Block", action: "drop", paragraphs: [] },
  ],
};

describe("noteToMarkdown", () => {
  const md = noteToMarkdown(note, header, ["**Risk** — contains a value that could not be found in the recording."]);

  it("opens with the title, the draft line and the visit details", () => {
    expect(md.startsWith("# Psychiatric Progress Note")).toBe(true);
    expect(md).toContain(DRAFT_LINE);
    expect(md).toContain("**Patient:** Testcase, Alpha");
    expect(md).toContain("**Visit date:** 2026-11-01");
  });
  it("writes filled and kept sections, and leaves dropped ones out", () => {
    expect(md).toContain("## Progress Note Carry-Forward Block");
    expect(md).toContain("## Mental Status Examination");
    expect(md).not.toContain("Discharge Summary Carry-Forward Block");
  });
  it("marks an unverified value, shows what was removed, and flags a section needing confirmation", () => {
    expect(md).toContain("==Sertraline 150 mg==");
    expect(md).toContain("removed: The sister attempted suicide.");
    expect(md).toContain("Confirm every line of this section before signing.");
  });
  it("ends with the attention list", () => {
    expect(md).toContain("## Needs your attention");
    expect(md.indexOf("## Needs your attention")).toBeGreaterThan(md.indexOf("## Mental Status"));
  });
  it("says so plainly when nothing was flagged", () => {
    expect(noteToMarkdown(note, header, [])).toContain("Nothing was flagged.");
  });
});

describe("formToMarkdown", () => {
  // Includes a risk-bearing field: the first six are not, so slicing there would have tested nothing.
  const fields = PROGRESS_NOTE_FIELDS.slice(0, 8);
  const md = formToMarkdown("Psychiatrist Progress Note", fields, { "*Sleep": { ticked: ["Poor"] }, "Chief Complaint": { text: "I feel low" } }, header, []);

  it("ticks only the chosen option and leaves the rest blank", () => {
    expect(md).toContain("- [x] Poor");
    expect(md).toContain("- [ ] Good");
    expect(md).toContain("- [ ] Fair");
  });
  it("writes free text, and says not discussed where there is none", () => {
    expect(md).toContain("I feel low");
    expect(md).toContain("[Not discussed in this visit: Subjective]");
  });
  it("marks the risk-bearing fields", () => {
    expect(md).toContain("⚠︎");
  });
});

describe("isDraft", () => {
  it("is true until a person deletes the draft line", () => {
    const md = noteToMarkdown(note, header, []);
    expect(isDraft(md)).toBe(true);
    expect(isDraft(md.replace(DRAFT_LINE, ""))).toBe(false);
  });
});

describe("markdownToHtml", () => {
  it("renders headings, task boxes, bullets, quotes and highlights", () => {
    const html = markdownToHtml("# T\n\n## S\n\n- [x] done\n- [ ] not\n\n- plain\n\n> quote\n\n==flag== and **bold**");
    expect(html).toContain("<h1>T</h1>");
    expect(html).toContain("<h2>S</h2>");
    expect(html).toContain("☒"); // ticked box
    expect(html).toContain("☐"); // empty box
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<mark>flag</mark>");
    expect(html).toContain("<strong>bold</strong>");
  });
  it("escapes anything that looks like markup, since a document is patient text", () => {
    const html = markdownToHtml('The patient said <script>alert("x")</script> & more');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });
  it("wraps into a printable page with a title", () => {
    const page = markdownToPrintableHtml("# A", 'Testcase "A" <b>');
    expect(page).toContain("<!doctype html>");
    expect(page).toContain("@page");
    expect(page).not.toMatch(/<title>[^<]*<b>/);
  });
});

describe("the ported library still behaves", () => {
  it("maps appointment types to documents", () => {
    expect(documentsFor("Follow-up & Discharge Order").map((d) => d.label))
      .toEqual(["Progress Note", "Follow-up", "Discharge Order", "Discharge Summary"]);
  });
  it("shows initials", () => {
    expect(patientInitials("Testcase", "Alpha")).toBe("A.T.");
  });
});
