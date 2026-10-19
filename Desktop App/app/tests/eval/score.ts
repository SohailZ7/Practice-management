// Scoring for the model comparison. Pure, so it is unit-tested with hand-made drafts.
import type { DraftNote } from "../../src/lib/types";
import { NOT_DISCUSSED } from "../../src/lib/sectionMap";
import { isNotDiscussed } from "../../src/lib/pipeline";
import type { Case, Check } from "./types";

const title = (h: string) => h.replace(/^\d+\.\s*/, "");

function paras(note: DraftNote, section?: string) {
  const re = section ? new RegExp(section, "i") : null;
  return note.sections
    .filter((s) => s.action === "fill" || s.action === "info")
    .filter((s) => !re || re.test(title(s.heading)))
    .flatMap((s) => s.paragraphs.map((p) => ({ section: title(s.heading), ...p })));
}

export type CheckResult = { id: string; kind: Check["kind"]; ok: boolean; critical: boolean; why: string };

export function runCheck(note: DraftNote, c: Check): CheckResult {
  const base = { id: c.id, kind: c.kind, critical: !!c.critical, why: c.why };
  if (c.kind === "nd") {
    const hits = paras(note, c.section).filter((p) => p.label === c.label);
    // A label that is missing from the draft also counts as nothing invented.
    return { ...base, ok: hits.every((p) => isNotDiscussed(p.text)) };
  }
  const text = paras(note, c.section).map((p) => `${p.label ?? ""} ${p.text}`).join("\n");
  const found = new RegExp(c.pattern!, "i").test(text);
  return { ...base, ok: c.kind === "has" ? found : !found };
}

// Words with no clinical content; everything else counts toward the unsupported-word rate.
const STOP = new Set("about after again also been before being could does doing from have having into just like make more most much only other over said same should some such than that their them then there these they this those through very were what when where which while with would your patient reports report provider doctor discussed discussion statement states stated recording".split(" "));

/** Share of content words in the draft whose stem (first five letters) appears nowhere in the sources. Informational. */
export function unsupportedRate(note: DraftNote, source: string): { rate: number; words: string[] } {
  const stems = new Set((source.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.slice(0, 5)));
  const out: string[] = [];
  let total = 0;
  for (const p of paras(note)) {
    if (p.flag === "not_discussed" || p.flag === "not_assessed" || p.text === NOT_DISCUSSED) continue;
    for (const w of p.text.toLowerCase().match(/[a-z]{5,}/g) ?? []) {
      if (STOP.has(w)) continue;
      total += 1;
      if (!stems.has(w.slice(0, 5))) out.push(w);
    }
  }
  return { rate: total ? out.length / total : 0, words: [...new Set(out)] };
}

export type CaseScore = { caseId: string; results: CheckResult[]; unsupported: { rate: number; words: string[] } };

export function scoreCase(c: Case, note: DraftNote): CaseScore {
  return { caseId: c.id, results: c.checks.map((k) => runCheck(note, k)), unsupported: unsupportedRate(note, `${c.transcript}\n${c.priorNote ?? ""}`) };
}

export type Summary = {
  facts: [number, number]; // has: passed / total
  errors: [number, number]; // lacks: clean / total (higher is better)
  inventions: [number, number]; // nd: clean / total
  critical: [number, number]; // all critical checks: passed / total
  unsupportedRate: number;
};

export function summarize(scores: CaseScore[]): Summary {
  const tally = (pred: (r: CheckResult) => boolean): [number, number] => {
    const rs = scores.flatMap((s) => s.results).filter(pred);
    return [rs.filter((r) => r.ok).length, rs.length];
  };
  const rates = scores.map((s) => s.unsupported.rate);
  return {
    facts: tally((r) => r.kind === "has"),
    errors: tally((r) => r.kind === "lacks"),
    inventions: tally((r) => r.kind === "nd"),
    critical: tally((r) => r.critical),
    unsupportedRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0,
  };
}
