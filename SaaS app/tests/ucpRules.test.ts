// UHS documentation rules: prompt content, gap check, and end-to-end with a stub model. Fake transcripts only.
import { describe, it, expect } from "vitest";
import { ucpSystem, ucpTypeFor, ucpFormAddendum, scanText, gapCheck, GAP_SYSTEM, requiredFor, UCP_VERSION } from "../src/lib/notes/ucpRules";
import { generateDocuments } from "../src/lib/notes/generate";
import type { Llm } from "../src/lib/notes/types";

const FAKE = "Doctor: How has sleep been? Patient: I'm only sleeping about three hours a night. Doctor: Any change to the medication? Patient: No. Doctor: Okay, we will keep the same dose.";

describe("ucpRules prompt text", () => {
  it("maps document kinds to rule sets", () => {
    expect(ucpTypeFor("EVAL_NOTE")).toBe("psych_eval");
    expect(ucpTypeFor("PROGRESS_FORM")).toBe("progress_note");
    expect(ucpTypeFor("FOLLOWUP_NOTE")).toBe("progress_note");
    expect(ucpTypeFor("DISCHARGE_NOTE")).toBe("discharge_summary");
    expect(ucpTypeFor("ADMIT_FORM")).toBeNull();
  });
  it("carries the anti-fabrication rule, strong/weak pairs, stems and the payer caveat", () => {
    for (const t of ["psych_eval", "progress_note", "discharge_summary"] as const) {
      const s = ucpSystem(t);
      expect(s).toMatch(/NEVER invent a clinical fact/);
      expect(s).toMatch(/Not discussed in this visit: <item>/);
      expect(s).toMatch(/Strong \(style only\)/);
      expect(s).toMatch(/Weak \(avoid\)/);
      expect(s).toMatch(/A lower level of care is not appropriate because/);
      expect(s).toMatch(/payer/i);
    }
    expect(ucpSystem("progress_note")).toMatch(/RECERTIFICATION/);
    expect(ucpSystem("psych_eval")).not.toMatch(/RECERTIFICATION/);
    expect(ucpSystem("psych_eval")).toMatch(/certification/i);
  });
  it("does not assert payer-specific deadlines as requirements", () => {
    expect(ucpSystem("progress_note")).toMatch(/Do not state when a recertification is due/);
  });
  it("form addendum forbids unsaid improvement words", () => {
    expect(ucpFormAddendum()).toMatch(/Never write improving/);
  });
  it("version is set", () => expect(UCP_VERSION).toBeTruthy());
});

describe("scanText", () => {
  it("lists placeholders as missing", () => {
    const g = scanText("**Risk:** **[Not discussed in this visit: Suicide risk]**");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatch(/Missing: Suicide risk/);
  });
  it("flags vague words with no evidence and passes specific ones", () => {
    expect(scanText("The patient is improving.")[0]).toMatch(/^Weak:/);
    expect(scanText("The patient is improving, as evidenced by sleeping 6 hours.")).toHaveLength(0);
    expect(scanText('The patient said "I feel better" and is stable.').length).toBe(0);
  });
});

describe("gapCheck", () => {
  const doc = "The patient is improving.\n**Medication:** **[Not discussed in this visit: Medication changes]**";
  it("adds LLM verdicts for missing and weak elements, skips present ones", async () => {
    const llm: Llm = async ({ system }) => {
      expect(system).toBe(GAP_SYSTEM);
      return "service_type: PRESENT | header has it\nloc_rationale: MISSING | no reason given\nsymptoms: WEAK | only improving\nrisk: PRESENT | said";
    };
    const r = await gapCheck(llm, "progress_note", doc);
    expect(r.checked).toBe(true);
    expect(r.gaps.some((g) => /Why this level of care is still needed/.test(g) && /^Missing/.test(g))).toBe(true);
    expect(r.gaps.some((g) => /Today's symptoms with specifics/.test(g) && /^Weak/.test(g))).toBe(true);
    expect(r.gaps.some((g) => /Risk and safety today/.test(g))).toBe(false);
  });
  it("says so when the check cannot run", async () => {
    const r = await gapCheck(async () => { throw new Error("down"); }, "progress_note", doc);
    expect(r.checked).toBe(false);
    expect(r.gaps.join(" ")).toMatch(/could not run/);
    const r2 = await gapCheck(async () => "no idea", "progress_note", doc);
    expect(r2.checked).toBe(false);
  });
  it("every document type has required elements", () => {
    for (const t of ["psych_eval", "progress_note", "discharge_summary", "h_and_p"] as const) expect(requiredFor(t).length).toBeGreaterThan(2);
  });
});

describe("generateDocuments with the rules", () => {
  it("sends the rules to the model, shows visible placeholders, and ends with fix-before-signing items", async () => {
    const systems: string[] = [];
    const llm: Llm = async ({ system, prompt }) => {
      systems.push(system);
      if (system === GAP_SYSTEM) return "loc_rationale: MISSING | not stated\nmed_change: PRESENT | no change\nrisk: MISSING | none";
      if (system.includes("CHOOSE:")) return "CHOOSE: NONE\nTEXT: NONE";
      const labels = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
      if (labels.length && prompt.includes("SECTION:")) {
        return labels.map((l) => `${l}: ${l === "Current symptoms / changes" ? "The patient reports sleeping about three hours a night." : "Not discussed in this recording."}`).join("\n");
      }
      return "NO";
    };
    const docs = await generateDocuments({ appointmentType: "Follow-up", transcript: FAKE, visitDate: "2026-11-05", patientLabel: "Test, Patient", providerName: "Dr Test", llm });
    const note = docs.find((d) => d.kind === "FOLLOWUP_NOTE");
    expect(note).toBeTruthy();
    expect(systems.some((s) => s.includes("DOCUMENTATION STANDARD") && s.includes("RULES FOR THIS DOCUMENT"))).toBe(true);
    expect(note!.markdown).toMatch(/\[Not discussed in this visit: /);
    expect(note!.markdown).toMatch(/Fix before signing/);
    expect(note!.markdown).toMatch(/Critical Documentation Practices rules v/);
    expect(note!.markdown).not.toContain("Not discussed in this recording");
    expect(note!.gaps!.length).toBeGreaterThan(0);
  });
});
