import { describe, expect, it } from "vitest";
import { evalCases } from "./eval/evalCases";
import { visitCases } from "./eval/visitCases";
import { runCheck, scoreCase, summarize, unsupportedRate } from "./eval/score";
import { PLANS } from "../src/lib/sectionMap";
import type { Case } from "./eval/types";
import type { DraftNote } from "../src/lib/types";

const cases: Case[] = [...evalCases, ...visitCases];
const title = (h: string) => h.replace(/^\d+\.\s*/, "");

describe("test set integrity", () => {
  it("has 10+ cases of all three kinds with unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const k of ["EVAL", "FOLLOW_UP", "DISCHARGE"]) expect(cases.some((c) => c.kind === k)).toBe(true);
  });
  it("follow-ups and discharges carry a prior note, evaluations do not", () => {
    for (const c of cases) expect(!!c.priorNote).toBe(c.kind !== "EVAL");
  });
  it("every check points at a real section and label of its note type, with a valid pattern", () => {
    for (const c of cases) {
      const plan = PLANS[c.kind].sections.filter((s) => s.action === "fill");
      for (const k of c.checks) {
        if (k.section) {
          const re = new RegExp(k.section, "i");
          expect(plan.some((s) => re.test(title(s.heading))), `${c.id}/${k.id}: section "${k.section}"`).toBe(true);
        }
        if (k.kind === "nd") {
          const spec = plan.find((s) => new RegExp(k.section ?? "", "i").test(title(s.heading)));
          expect(spec?.labels?.includes(k.label ?? ""), `${c.id}/${k.id}: label "${k.label}"`).toBe(true);
        } else {
          expect(() => new RegExp(k.pattern!, "i"), `${c.id}/${k.id}`).not.toThrow();
        }
      }
    }
  });
  it("uses only synthetic content: no real-looking identifiers", () => {
    for (const c of cases) expect(`${c.transcript}${c.priorNote ?? ""}`).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b|@|\b\d{10}\b/);
  });
});

const note = (sections: { heading: string; paras: [string, string, string?][] }[]): DraftNote => ({
  kind: "EVAL",
  title: "t",
  sections: sections.map((s) => ({ heading: s.heading, action: "fill", paragraphs: s.paras.map(([label, text, flag]) => ({ label, text, flag: flag as never })) })),
});

describe("scorer", () => {
  const n = note([
    { heading: "6. Suicide Risk Assessment - Columbia / C-SSRS Documentation Area", paras: [["Suicidal thoughts", "The patient denies suicidal thoughts."]] },
    { heading: "8. Medical / Surgical History", paras: [["Allergies", "Not discussed in this recording.", "not_discussed"], ["Medical history", "Depression"]] },
  ]);
  it("has: finds a fact in the named section only", () => {
    expect(runCheck(n, { id: "a", kind: "has", section: "Suicide", pattern: "denies", why: "" }).ok).toBe(true);
    expect(runCheck(n, { id: "a", kind: "has", section: "Medical", pattern: "denies", why: "" }).ok).toBe(false);
  });
  it("lacks: fails when a wrong statement is present", () => {
    expect(runCheck(n, { id: "b", kind: "lacks", section: "Medical", pattern: "depress", why: "" }).ok).toBe(false);
    expect(runCheck(n, { id: "b", kind: "lacks", pattern: "bipolar", why: "" }).ok).toBe(true);
  });
  it("nd: requires the not-discussed sentence, also when reworded; a filled value is an invention", () => {
    expect(runCheck(n, { id: "c", kind: "nd", section: "Medical", label: "Allergies", why: "" }).ok).toBe(true);
    expect(runCheck(n, { id: "c", kind: "nd", section: "Medical", label: "Medical history", why: "" }).ok).toBe(false);
  });
  it("matches labels as part of the section text", () => {
    expect(runCheck(n, { id: "d", kind: "has", section: "Suicide", pattern: "Suicidal thoughts", why: "" }).ok).toBe(true);
  });
  it("summarizes recall, errors, inventions and critical checks", () => {
    const c: Case = {
      id: "X", title: "", kind: "EVAL", transcript: "The patient denies suicidal thoughts and has asthma.",
      checks: [
        { id: "1", kind: "has", section: "Suicide", pattern: "denies", why: "", critical: true },
        { id: "2", kind: "lacks", section: "Medical", pattern: "depress", why: "" },
        { id: "3", kind: "nd", section: "Medical", label: "Allergies", why: "" },
      ],
    };
    const s = summarize([scoreCase(c, n)]);
    expect(s.facts).toEqual([1, 1]);
    expect(s.errors).toEqual([0, 1]);
    expect(s.inventions).toEqual([1, 1]);
    expect(s.critical).toEqual([1, 1]);
  });
  it("unsupported-word rate flags content words absent from the sources", () => {
    const r = unsupportedRate(n, "The patient denies suicidal thoughts.");
    expect(r.words).toContain("depression");
    expect(r.rate).toBeGreaterThan(0);
  });
});

describe("negation-aware checks", () => {
  const find = (id: string) => cases.flatMap((c) => c.checks).find((k) => k.id === id)!;
  const n = (text: string) => note([{ heading: "17. Medication / Biological Treatment Informed-Consent Module", paras: [["Medication action", text]] }]);
  it("does not flag a declined benzodiazepine, but flags one that was started", () => {
    const k = { ...find("no-sleeping-pill"), section: undefined };
    expect(runCheck(n("The provider did not prescribe any sleeping pills or benzodiazepines."), k).ok).toBe(true);
    expect(runCheck(n("The provider will start a benzodiazepine."), k).ok).toBe(false);
  });
  it("does not flag 'discontinued lithium' as continued, but flags a continued one", () => {
    const k = { ...find("lithium-not-continued"), section: undefined };
    expect(runCheck(n("Lithium was discontinued because of tremor."), k).ok).toBe(true);
    expect(runCheck(n("The patient will continue lithium 600 milligrams."), k).ok).toBe(false);
  });
  it("does not flag a declined escitalopram, but flags one listed as continued", () => {
    const k = { ...find("not-continued"), section: undefined };
    expect(runCheck(n("The patient declines to continue escitalopram."), k).ok).toBe(true);
    expect(runCheck(n("Discharged on escitalopram 10 milligrams."), k).ok).toBe(false);
  });
});
