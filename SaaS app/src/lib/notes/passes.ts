// Two extra safety passes around the note drafting (desktop spec NOT-5, NOT-9, DOC-2).
//  1. Suicide-risk questions: each C-SSRS line is its own yes / no / not-asked question that must quote the transcript, so a
//     patient's denial is recorded and a relative's attempt is not mistaken for the patient's.
//  2. Verification: every drafted sentence is checked against the transcript. Unsupported sentences, and sentences about
//     someone other than the patient in a patient-history section, are taken out, shown to the provider and restorable.
import type { Llm, Para } from "./types";
import { NOT_DISCUSSED } from "./sectionMap";
import { withDigits } from "./grounding";
import { stripThinking } from "./text";

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** True when (nearly) all of the quote's words appear in the source in order, tolerating small gaps and rewording. */
export function quoteInSource(quote: string, source: string): boolean {
  const q = words(quote);
  if (q.length < 2) return false;
  const s = words(source);
  const joined = ` ${s.join(" ")} `;
  if (joined.includes(` ${q.join(" ")} `)) return true;
  let best = 0;
  for (let start = 0; start < s.length; start++) {
    if (s[start] !== q[0] && !q.slice(0, 3).includes(s[start])) continue;
    let qi = 0;
    let matched = 0;
    for (let i = start; i < s.length && i < start + q.length * 2 + 6 && qi < q.length; i++) {
      if (s[i] === q[qi]) { matched += 1; qi += 1; }
      else if (q[qi + 1] === s[i]) { qi += 2; matched += 1; }
    }
    best = Math.max(best, matched / q.length);
    if (best >= 0.85) return true;
  }
  return best >= 0.85;
}

export type Answer = { answer: "YES" | "NO" | "NOT_ASKED" | "UNPARSED"; statement: string; quote: string };

export function parseAnswer(raw: string): Answer {
  const text = stripThinking(raw).replace(/\*\*/g, "");
  const a = /ANSWER[ \t]*:[ \t]*(NOT[_ ]ASKED|YES|NO)\b/i.exec(text)?.[1]?.toUpperCase().replace(" ", "_");
  const statement = /STATEMENT[ \t]*:[ \t]*(.*)/i.exec(text)?.[1]?.trim() ?? "";
  const quote = /QUOTE[ \t]*:[ \t]*(.*)/i.exec(text)?.[1]?.trim().replace(/^["“']|["”']$/g, "") ?? "";
  if (!a) return { answer: "UNPARSED", statement: text.trim(), quote: "" };
  return { answer: a as Answer["answer"], statement, quote };
}

export const QUESTION_SYSTEM = [
  "You answer one question about a psychiatric visit transcript.",
  "Only the PATIENT's own statements count about the patient. What a relative, spouse or friend did or said is not the patient's.",
  "Use only what the transcript says. Do not guess. A denial (\"no\", \"never\") is an answer: record it.",
  "Reply with exactly three lines and nothing else:",
  "ANSWER: YES, NO or NOT_ASKED (NOT_ASKED only if the transcript never addresses the question)",
  "STATEMENT: one sentence in the third person (\"The patient denies ...\" / \"The patient reports ...\"); empty if NOT_ASKED",
  "QUOTE: the exact words from the transcript that support it; empty if NOT_ASKED",
].join("\n");

/** For these lines a missing answer is not a statement ("does not report reasons for living" is an invention), so NO counts as not discussed. */
const YES_ONLY = new Set(["Protective factors", "Safety plan discussed"]);

/** "Does not report / mention / express ..." describes an absence in the transcript, not something the patient said. */
const ABSENCE = /\b(does|did|do) not (report|mention|express|describe|state|indicate|say|discuss|provide|give|identify)\b|\bno (mention|report|indication|evidence)\b|\bnot (reported|mentioned|expressed|stated|discussed)\b/i;

/** One C-SSRS line. NOT_ASKED stays "not discussed"; an unparseable reply is kept but flagged for the provider. */
export async function askRiskQuestion(llm: Llm, transcript: string, label: string, question: string): Promise<Para> {
  const raw = await llm({ system: QUESTION_SYSTEM, prompt: `TRANSCRIPT:\n<<<\n${transcript.trim()}\n>>>\n\nQUESTION: ${question}` });
  const a = parseAnswer(raw);
  if (a.answer === "NOT_ASKED" || (a.answer === "NO" && YES_ONLY.has(label)) || (a.answer !== "UNPARSED" && !a.statement)) return { label, text: NOT_DISCUSSED, flag: "not_discussed" };
  if (ABSENCE.test(a.statement) && !/\b(denies|denied|reports no|says no)\b/i.test(a.statement)) return { label, text: NOT_DISCUSSED, flag: "not_discussed" };
  if (a.answer === "UNPARSED") return { label, text: a.statement || NOT_DISCUSSED, flag: "confirm" };
  if (!quoteInSource(a.quote, transcript)) return { label, text: a.statement, flag: "ungrounded", evidence: a.quote };
  return { label, text: a.statement, evidence: a.quote };
}

export type Verdict = { n: number; supported: boolean; about: string; saidBy: string; quote: string };

export const VERIFY_SYSTEM = [
  "You check sentences from a draft clinic note against the visit transcript.",
  "For each numbered sentence reply with exactly one line:",
  "N | SUPPORTED or UNSUPPORTED | ABOUT: PATIENT, FAMILY, OTHER or DOCTOR_PLAN | SAID_BY: PATIENT, DOCTOR, OTHER or UNCLEAR | QUOTE: exact words from the transcript",
  "SUPPORTED only if the transcript or prior note states it. An invented number, drug, dose, reason or denial is UNSUPPORTED.",
  "ABOUT is who the fact concerns: the patient; a family member (mother, sister, uncle, ...); another person (spouse, friend, ...); or the doctor's own plan or recommendation.",
  "SAID_BY is who said it: the patient, the doctor, another person present (spouse, parent, ...), or UNCLEAR.",
  "Leave QUOTE empty if UNSUPPORTED. No other text.",
].join("\n");

export function parseVerdicts(raw: string): Verdict[] {
  const out: Verdict[] = [];
  for (const line of stripThinking(raw).replace(/\*\*/g, "").split("\n")) {
    const m = /^\s*(\d+)\s*[|.:)\-]\s*(SUPPORTED|UNSUPPORTED)\b(.*)$/i.exec(line);
    if (!m) continue;
    const rest = m[3];
    out.push({
      n: Number(m[1]),
      supported: m[2].toUpperCase() === "SUPPORTED",
      about: /ABOUT\s*:\s*([A-Z_]+)/i.exec(rest)?.[1]?.toUpperCase() ?? "",
      saidBy: /SAID_BY\s*:\s*([A-Z_]+)/i.exec(rest)?.[1]?.toUpperCase() ?? "",
      quote: /QUOTE\s*:\s*(.*)$/i.exec(rest)?.[1]?.trim().replace(/^["“']|["”']$/g, "") ?? "",
    });
  }
  return out;
}

const PATIENT_LEAD = /^(the )?patient (reports|states|says|mentions|describes|notes)\b/i;

/** Applies verdicts to a section's paragraphs. Pure, so it is tested without a model. */
export function applyVerdicts(paras: Para[], verdicts: Verdict[], source: string, aboutPatient: boolean): Para[] {
  const by = new Map(verdicts.map((v) => [v.n, v]));
  return paras.map((p, i) => {
    if (p.flag === "not_discussed" || p.flag === "not_assessed") return p;
    const v = by.get(i + 1);
    if (!v) return p; // no verdict for this line: leave it for the provider's review
    const remove = (reason: string): Para => ({ label: p.label, text: NOT_DISCUSSED, flag: "removed", removed: { text: p.text, reason } });
    if (!v.supported) return remove("not supported by the transcript");
    if (aboutPatient && (v.about === "FAMILY" || v.about === "OTHER")) return remove("about someone other than the patient");
    let text = p.text;
    // A supporting quote the verifier cannot show in the transcript is a warning, not proof: keep the line, ask the provider.
    let flag: Para["flag"] = v.quote && !quoteInSource(v.quote, source) ? "ungrounded" : p.flag;
    if (v.saidBy === "OTHER" && PATIENT_LEAD.test(text)) text = text.replace(PATIENT_LEAD, "Another person present reports");
    else if (v.saidBy === "DOCTOR" && /^(the )?patient (requests?|requested|asks?|asked|wants?|wanted|suggests?|proposes?)\b/i.test(text)) flag = "confirm";
    return { ...p, text, flag, evidence: v.quote || p.evidence };
  });
}

export async function verifyParas(llm: Llm, source: string, paras: Para[], aboutPatient: boolean): Promise<Para[]> {
  const idx = paras.map((p, i) => ({ p, i })).filter(({ p }) => p.flag !== "not_discussed" && p.flag !== "not_assessed");
  if (!idx.length) return paras;
  const list = paras.map((p, i) => `${i + 1}. ${p.label ? `${p.label}: ` : ""}${p.text}`).join("\n");
  // Spelled-out numbers also appear as digits ("two 2"), so "2 milligrams" is not judged unsupported by "two milligrams".
  const shown = withDigits(source.trim());
  const raw = await llm({ system: VERIFY_SYSTEM, prompt: `TRANSCRIPT AND PRIOR NOTE:\n<<<\n${shown}\n>>>\n\nSENTENCES:\n${list}` });
  return applyVerdicts(paras, parseVerdicts(raw), shown, aboutPatient);
}
