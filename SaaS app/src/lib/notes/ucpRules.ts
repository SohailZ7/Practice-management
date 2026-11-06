// UHS "Critical Documentation Practices" rules for the note writer. The rules themselves live in
// prompts/ucp-rules.v1.json so they can be edited without touching code. This file loads them, builds the prompt
// text for each document type, and runs the gap check (what a clinician must fix before signing).
//
// Safety: the rules never supply clinical content. Every example is style only; facts come from the transcript.

import rules from "./prompts/ucp-rules.v1.json";
import type { Llm } from "./types";
import { stripThinking } from "./text";

export type UcpDocType = "psych_eval" | "progress_note" | "discharge_summary" | "h_and_p";
type Required = { id: string; label: string };
type DocRules = { label: string; rules: string[]; required: Required[] };
const R = rules as unknown as {
  version: string;
  payerNote: string;
  antiFabrication: string[];
  levelOfCareNote: string;
  docTypes: Record<string, DocRules>;
  medicalNecessity: { intro: string; pairs: { topic: string; strong: string; weak: string }[] };
  stems: { note: string; groups: Record<string, string[]> };
  vagueTerms: string[];
  evidenceMarkers: string[];
};

export const UCP_VERSION = R.version;

/** The document kinds the app generates, mapped to a rule set. Forms for orders share the closest narrative rules. */
export function ucpTypeFor(kind: string): UcpDocType | null {
  switch (kind) {
    case "EVAL_NOTE": return "psych_eval";
    case "PROGRESS_FORM":
    case "FOLLOWUP_NOTE": return "progress_note";
    case "DISCHARGE_NOTE":
    case "DISCHARGE_FORM": return "discharge_summary";
    default: return null; // admit order: no UCP narrative rules
  }
}

/** The visible placeholder for an item the visit did not cover. */
export const notDiscussedItem = (item: string) => `[Not discussed in this visit: ${item}]`;

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

/** Rules text added to the note writer's system prompt for one document type. */
export function ucpSystem(type: UcpDocType): string {
  const d = R.docTypes[type];
  const parts = [
    `DOCUMENTATION STANDARD (UHS Critical Documentation Practices, rules v${R.version}). Document type: ${d.label}.`,
    "HARD RULES:\n" + bullets(R.antiFabrication),
    `${R.levelOfCareNote}\n${R.payerNote}`,
    `RULES FOR THIS DOCUMENT:\n${bullets(d.rules)}`,
  ];
  if (type === "progress_note" || type === "psych_eval" || type === "discharge_summary") {
    parts.push(
      `${R.medicalNecessity.intro}\n` +
        R.medicalNecessity.pairs.map((p) => `${p.topic}\n  Strong (style only): ${p.strong}\n  Weak (avoid): ${p.weak}`).join("\n"),
    );
    parts.push(
      `${R.stems.note}\n` + Object.entries(R.stems.groups).map(([g, s]) => `${g}: ${s.join(" | ")}`).join("\n"),
    );
  }
  if (type === "progress_note") {
    const rc = R.docTypes.recertification;
    parts.push(`RECERTIFICATION (only if said in this visit):\n${bullets(rc.rules)}`);
  }
  return parts.join("\n\n");
}

/** Short addendum for the checkbox forms' free-text answers (the form prompt allows only a short phrase). */
export function ucpFormAddendum(): string {
  return [
    "DOCUMENTATION STANDARD: for TEXT answers you may use up to 30 words. Prefer specifics the speaker gave (what, how often, effect on work, sleep or self-care) over general words.",
    "If the patient said something memorable about this topic, you may quote up to 12 words in quotation marks. Quote only words that are in the transcript.",
    "Never write improving, better, stable or similar unless a speaker said it. If the topic was not said, answer NONE. Never invent a fact.",
  ].join("\n");
}

export type GapResult = { gaps: string[]; checked: boolean; version: string };

const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** Deterministic part: placeholders left in the text, and vague words with no evidence next to them. */
export function scanText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const placeholder = /\[Not discussed in this visit:\s*([^\]]+)\]/gi;
  for (const m of text.matchAll(placeholder)) {
    const item = m[1].trim();
    if (!seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      out.push(`Missing: ${item}. It was not said in this visit; add it or document why it does not apply.`);
    }
  }
  const markers = R.evidenceMarkers.map((x) => x.toLowerCase());
  for (const s of sentences(text)) {
    if (/\[Not discussed/i.test(s)) continue;
    const low = s.toLowerCase();
    const term = R.vagueTerms.find((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(low));
    if (!term) continue;
    if (/\d/.test(s) || markers.some((m) => low.includes(m))) continue;
    out.push(`Weak: "${s.length > 110 ? s.slice(0, 107) + "..." : s}" is general. Say what it was based on (what the patient did or said, how often, effect on function).`);
  }
  return out;
}

export const GAP_SYSTEM = [
  "You check a drafted psychiatric document against a list of required elements. You do not write or fix the document.",
  "For each element reply with exactly one line: ID: PRESENT or WEAK or MISSING | reason in at most 15 words.",
  "PRESENT: the document states it specifically. WEAK: it is mentioned only in general words (for example just 'improving' or 'doing well'). MISSING: it is not stated, or only a not-discussed placeholder is there.",
  "Judge only what the document says. Do not use outside knowledge. No other text.",
].join("\n");

/** Gap check: lists required elements that are missing or weak so the clinician can fix them before signing. */
export async function gapCheck(llm: Llm, type: UcpDocType, documentText: string): Promise<GapResult> {
  const d = R.docTypes[type];
  const gaps = scanText(documentText);
  let checked = true;
  try {
    const list = d.required.map((r) => `${r.id}: ${r.label}`).join("\n");
    const raw = stripThinking(await llm({ system: GAP_SYSTEM, prompt: `DOCUMENT:\n<<<\n${documentText.trim()}\n>>>\n\nREQUIRED ELEMENTS:\n${list}` }));
    const byId = new Map(d.required.map((r) => [r.id, r.label]));
    let parsed = 0;
    for (const line of raw.split("\n")) {
      const m = /^\s*[-*]?\s*([a-z_]+)\s*:\s*(PRESENT|WEAK|MISSING)\b\s*\|?\s*(.*)$/i.exec(line);
      if (!m || !byId.has(m[1].toLowerCase())) continue;
      parsed += 1;
      const verdict = m[2].toUpperCase();
      const label = byId.get(m[1].toLowerCase())!;
      const why = m[3].trim().replace(/\.$/, "");
      const already = gaps.some((g) => g.toLowerCase().includes(label.toLowerCase().slice(0, 18)));
      if (verdict === "PRESENT" || already) continue;
      gaps.push(`${verdict === "WEAK" ? "Weak" : "Missing"}: ${label}${why ? ` (${why})` : ""}.`);
    }
    if (!parsed) checked = false;
  } catch {
    checked = false;
  }
  if (!checked) gaps.push("The automatic gap check could not run. Check the required elements for this document yourself.");
  return { gaps, checked, version: R.version };
}

/** A required-elements checklist for one document type (shown to the clinician, used in tests). */
export const requiredFor = (type: UcpDocType): Required[] => R.docTypes[type].required;
