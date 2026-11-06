import { describe, expect, it } from "vitest";
import fields from "./qa/progress-fields.json";
import { humanize, layoutFields } from "../src/lib/formLayout";
import type { DocField } from "../src/lib/api";

const all = fields as DocField[];

describe("form layout", () => {
  const blocks = layoutFields(all);
  const sections = blocks.flatMap((b) => (b.kind === "section" ? [b.section] : []));
  it("makes the sections of the printed progress note", () => {
    expect(sections.map((s) => s.key)).toEqual(expect.arrayContaining(["IH", "PS", "MSE", "Risk", "Therapy", "CareCoord"]));
    expect(sections.find((s) => s.key === "IH")?.paired).toBe(true);
  });
  it("puts the ADL choices on one row, in order", () => {
    const adl = sections.find((s) => s.key === "IH")!.rows.find((r) => r.key === "ADL")!;
    expect(adl.label).toBe("ADL's");
    expect(adl.items.map((i) => i.label)).toEqual(["Independent", "Fair", "Poor", "Needs Prompt", "Needs Assistance"]);
  });
  it("keeps every field exactly once, except the patient header fields", () => {
    const shown = blocks.flatMap((b) => (b.kind === "top" ? [b.field.name] : b.section.rows.flatMap((r) => r.items.map((i) => i.field.name))));
    expect(new Set(shown).size).toBe(shown.length);
    const hidden = all.map((f) => f.name).filter((n) => !shown.includes(n));
    expect(hidden.every((n) => /_p2$|^Patient|^EncounterDate$/.test(n))).toBe(true);
  });
  it("keeps the free text of a choice beside it", () => {
    const sp = sections.find((s) => s.key === "PS")!.rows.find((r) => r.key === "Complaint")!;
    expect(sp.items.some((i) => i.field.name === "PS_Complaint_OtherText" && i.field.type === "text")).toBe(true);
  });
  it("humanizes names", () => {
    expect(humanize("NeedsPrompt")).toBe("Needs Prompt");
    expect(humanize("Med01")).toBe("Med 01");
  });
});
