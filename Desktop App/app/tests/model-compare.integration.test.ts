// Compares local models on one synthetic transcript with known facts. Skipped unless SPIKE_MODELS is set. Example:
//   SPIKE_MODELS=qwen2.5:7b-instruct,qwen2.5:14b-instruct SPIKE_TRANSCRIPT=t.txt SPIKE_OUT=report.txt npx vitest run tests/model-compare.integration.test.ts
import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { draftNote } from "../src/lib/pipeline";
import type { DraftNote, Llm } from "../src/lib/types";

const models = (process.env.SPIKE_MODELS ?? "").split(",").filter(Boolean);

const make = (model: string, seed: number): Llm => async ({ system, prompt }) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({ model, stream: false, options: { temperature: 0.1, num_ctx: 16384, seed }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  return (await r.json()).message.content as string;
};

const all = (n: DraftNote) => n.sections.flatMap((s) => s.paragraphs.map((p) => ({ section: s.heading.replace(/^\d+\.\s*/, ""), label: p.label ?? "", text: p.text, flag: p.flag })));
const find = (n: DraftNote, section: RegExp, label?: string) => all(n).filter((p) => section.test(p.section) && (!label || p.label === label));
const joined = (n: DraftNote, section: RegExp) => find(n, section).map((p) => `${p.label} ${p.text}`).join(" ");

// Known facts in the synthetic transcript. Each check returns true when the note is right.
const CHECKS: [string, (n: DraftNote) => boolean][] = [
  ["Duration about three months", (n) => /three months|3 months/i.test(joined(n, /History of Present/))],
  ["Job loss as precipitant, not invented", (n) => /job/i.test(joined(n, /History of Present/))],
  ["Passive death wish recorded as the patient's, no plan, no attempts", (n) => /wish/i.test(joined(n, /Suicide/)) && /no plan|denies (having )?(a )?plan|without a plan|no (suicidal )?(intent|plan)/i.test(joined(n, /Suicide/))],
  ["No past hospitalization", (n) => /no\b.*(hospital)|never.*hospital|not.*hospital/i.test(joined(n, /Past Psychiatric/))],
  ["Family: mother depression (in Family section)", (n) => /mother/i.test(joined(n, /Family History/)) && /depress/i.test(joined(n, /Family History/))],
  ["Family history not attributed to the patient's own history", (n) => !/mother/i.test(joined(n, /Past Psychiatric|History of Present/))],
  ["Alcohol stopped a year ago", (n) => /alcohol|drinking/i.test(joined(n, /Substance/)) && /year/i.test(joined(n, /Substance/))],
  ["Lisinopril 10 mg under medical meds", (n) => /lisinopril/i.test(joined(n, /Medical/)) && /\b10\b|ten/i.test(joined(n, /Medical/))],
  ["Allergies: none known (or not discussed), nothing invented", (n) => !/(penicillin|sulfa|latex|peanut)/i.test(joined(n, /Medical/))],
  ["Sertraline 50 mg is the new medication (not 100, not 150)", (n) => /sertraline/i.test(joined(n, /Medication/)) && /\b50\b|fifty/i.test(joined(n, /Medication/)) && !/\b(100|150|25)\b/.test(joined(n, /Medication/))],
  ["Medication started by the doctor's plan; patient agrees", (n) => /agree|would like to try|consent/i.test(joined(n, /Medication/))],
  ["No sleeping pill or benzodiazepine started", (n) => !/(started|prescrib|will start)[^.]*(benzodiazepine|sleeping pill|lorazepam|zolpidem)/i.test(all(n).map((p) => p.text).join(" ")) || /not|no\b/i.test(all(n).map((p) => p.text).join(" "))],
  ["Side effects discussed (nausea, headache)", (n) => /nausea/i.test(joined(n, /Medication/)) && /headache/i.test(joined(n, /Medication/))],
  ["Therapy-only alternative discussed", (n) => /therap/i.test(joined(n, /Medication/))],
  ["Follow-up in two weeks", (n) => /two weeks|2 weeks/i.test(joined(n, /Level of Care|Medication|Treatment Plan/))],
  ["Doctor (not patient) proposes the medication", (n) => !/patient (requests|requested|wants|would like to (start|increase|take))\b[^.]*sertraline/i.test(all(n).map((p) => p.text).join(" "))],
  ["Diagnosis not stated as a final fact outside the doctor's words", (n) => !/diagnos(ed|is)[^.]*(bipolar|schizo|anxiety disorder)/i.test(all(n).map((p) => p.text).join(" "))],
  ["No ungrounded values flagged", (n) => all(n).every((p) => p.flag !== "ungrounded")],
];

const CHECKS_T1: [string, (n: DraftNote) => boolean][] = [
  ["Sleep: about three hours a night for about two weeks", (n) => /three hours|3 hours/i.test(all(n).map((p) => p.text).join(" ")) && /two weeks|2 weeks/i.test(joined(n, /History of Present/))],
  ["Missing work recorded", (n) => /work/i.test(joined(n, /History of Present|Personal/))],
  ["Patient denies suicidal thoughts", (n) => /deni|no\b.*(suicid|thoughts)/i.test(joined(n, /Suicide/))],
  ["Current sertraline 50 mg recorded as existing", (n) => /sertraline/i.test(joined(n, /Past Psychiatric|Medical|Medication/)) && /\b50\b|fifty/i.test(joined(n, /Past Psychiatric|Medical|Medication/))],
  ["Increase to 100 mg recorded", (n) => /\b100\b|hundred/i.test(joined(n, /Medication|Treatment Plan/))],
  ["The DOCTOR proposed the increase (not the patient requesting it), everywhere", (n) => !/patient[^.]{0,40}(request|ask|want|would like|propos|suggest)[^.]{0,40}(increase|100|hundred)/i.test(all(n).map((p) => p.text).join(" "))],
  ["Follow-up in two weeks", (n) => /two weeks|2 weeks/i.test(joined(n, /Level of Care|Medication|Treatment Plan/))],
  ["No diagnosis invented", (n) => !/(major depress|bipolar|insomnia disorder|anxiety disorder|mdd)/i.test(all(n).map((p) => p.text).join(" "))],
  ["No ungrounded values flagged", (n) => all(n).every((p) => p.flag !== "ungrounded")],
];

describe.skipIf(models.length === 0)("model comparison", () => {
  it("runs each model on the same transcript", async () => {
    const transcript = readFileSync(process.env.SPIKE_TRANSCRIPT!, "utf8").trim();
    let report = "";
    const runs = Number(process.env.SPIKE_RUNS ?? 1);
    const checks = process.env.SPIKE_CHECKS === "t1" ? CHECKS_T1 : CHECKS;
    for (const model of models) {
      const fails = new Map<string, number>();
      let passed = 0;
      let secsTotal = 0;
      let last: DraftNote | null = null;
      for (let run = 0; run < runs; run++) {
        const t0 = Date.now();
        const note = await draftNote({ kind: "EVAL", transcript, mode: "recording", visitDate: "2026-10-19", typeLabel: "Psych Eval", providerName: "Dr. Example", patientName: "Testcase, Alpha", llm: make(model, 1000 + run) });
        secsTotal += (Date.now() - t0) / 1000;
        for (const [name, fn] of checks) {
          if (fn(note)) passed += 1;
          else fails.set(name, (fails.get(name) ?? 0) + 1);
        }
        last = note;
      }
      report += `\n==== ${model}  avg ${Math.round(secsTotal / runs)}s  checks passed ${passed}/${checks.length * runs} over ${runs} runs\n`;
      for (const [name, n] of fails) report += `FAILED ${n}/${runs}  ${name}\n`;
      report += "\n-- Last draft (filled lines only) --\n";
      for (const p of all(last!)) if (p.flag !== "not_discussed" && p.flag !== "not_assessed") report += `[${p.section}] ${p.label ? p.label + ": " : ""}${p.text}${p.flag ? "  <" + p.flag + ">" : ""}\n`;
    }
    writeFileSync(process.env.SPIKE_OUT!, report);
  }, 3_600_000);
});
