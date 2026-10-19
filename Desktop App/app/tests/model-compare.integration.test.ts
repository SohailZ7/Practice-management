// Compares local models on the synthetic test set (tests/eval). Needs Ollama; skipped unless SPIKE_MODELS is set. Example:
//   SPIKE_MODELS=qwen2.5:7b-instruct,qwen2.5:14b-instruct SPIKE_RUNS=2 SPIKE_DIR=/tmp/eval npx vitest run tests/model-compare.integration.test.ts
// Each (model, case, run) is saved as JSON in SPIKE_DIR, so an interrupted run resumes and the report can be rebuilt.
import { describe, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { draftNote } from "../src/lib/pipeline";
import type { DraftNote, Llm } from "../src/lib/types";
import { evalCases } from "./eval/evalCases";
import { visitCases } from "./eval/visitCases";
import { scoreCase, summarize, type CaseScore } from "./eval/score";
import type { Case } from "./eval/types";

const models = (process.env.SPIKE_MODELS ?? "").split(",").filter(Boolean);
const runs = Number(process.env.SPIKE_RUNS ?? 1);
const dir = process.env.SPIKE_DIR ?? "/tmp/spike-eval";
const only = (process.env.SPIKE_CASES ?? "").split(",").filter(Boolean);
const cases: Case[] = [...evalCases, ...visitCases].filter((c) => !only.length || only.includes(c.id));

const make = (model: string, seed: number): Llm => async ({ system, prompt }) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({ model, stream: false, options: { temperature: 0.1, num_ctx: 16384, seed }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  return (await r.json()).message.content as string;
};

type Saved = { model: string; caseId: string; run: number; secs: number; draft: DraftNote; score: CaseScore };
const fileFor = (model: string, caseId: string, run: number) => path.join(dir, `${model.replace(/[^a-z0-9.]+/gi, "_")}__${caseId}__${run}.json`);

function report(): string {
  // Scores are recomputed from the saved drafts with the current checks, so fixing a check never needs a new run.
  const saved: Saved[] = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Saved)
    .filter((s) => cases.some((c) => c.id === s.caseId))
    .map((s) => ({ ...s, score: scoreCase(cases.find((c) => c.id === s.caseId)!, s.draft) }));
  const pct = ([a, b]: [number, number]) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : "n/a");
  let out = `# Model comparison\n\nCases: ${cases.length}. Runs per case: ${runs}.\n\n`;
  out += "| Model | Facts found | No wrong statements | No inventions | Critical checks | Unsupported words | Avg time per note |\n|---|---|---|---|---|---|---|\n";
  const modelNames = [...new Set(saved.map((s) => s.model))];
  for (const m of modelNames) {
    const mine = saved.filter((s) => s.model === m);
    const sum = summarize(mine.map((s) => s.score));
    const secs = mine.reduce((a, s) => a + s.secs, 0) / mine.length;
    out += `| ${m} | ${pct(sum.facts)} | ${pct(sum.errors)} | ${pct(sum.inventions)} | ${pct(sum.critical)} | ${(100 * sum.unsupportedRate).toFixed(1)}% | ${Math.round(secs)} s |\n`;
  }
  out += "\n## By note type (critical checks passed)\n\n| Model | Evaluation | Follow-up | Discharge |\n|---|---|---|---|\n";
  for (const m of modelNames) {
    const cell = (kind: string) => pct(summarize(saved.filter((s) => s.model === m && cases.find((c) => c.id === s.caseId)?.kind === kind).map((s) => s.score)).critical);
    out += `| ${m} | ${cell("EVAL")} | ${cell("FOLLOW_UP")} | ${cell("DISCHARGE")} |\n`;
  }
  out += "\n## Failed checks (count of runs failed / runs)\n";
  for (const m of modelNames) {
    out += `\n### ${m}\n`;
    const fails = new Map<string, { n: number; total: number; critical: boolean; why: string }>();
    for (const s of saved.filter((x) => x.model === m)) for (const r of s.score.results) {
      const key = `${s.caseId}/${r.id}`;
      const e = fails.get(key) ?? { n: 0, total: 0, critical: r.critical, why: r.why };
      e.total += 1;
      if (!r.ok) e.n += 1;
      fails.set(key, e);
    }
    for (const [k, e] of fails) if (e.n) out += `- ${e.critical ? "**CRITICAL** " : ""}${k}: ${e.n}/${e.total}  (${e.why})\n`;
  }
  return out;
}

describe.skipIf(models.length === 0)("model comparison", () => {
  it("runs every model on every case", async () => {
    mkdirSync(dir, { recursive: true });
    for (const model of models) for (const c of cases) for (let run = 0; run < runs; run++) {
      const file = fileFor(model, c.id, run);
      if (existsSync(file)) continue;
      const t0 = Date.now();
      const draft = await draftNote({
        kind: c.kind, transcript: c.transcript, mode: "recording", visitDate: "2026-10-19", typeLabel: c.title, providerName: "Dr. Example",
        patientName: "Testcase, Alpha", priorNote: c.priorNote ? { fileName: "prior.docx", text: c.priorNote } : undefined, llm: make(model, 1000 + run),
        passes: process.env.SPIKE_PASSES === "off" ? { ssrs: false, verify: false } : undefined,
      });
      const saved: Saved = { model, caseId: c.id, run, secs: (Date.now() - t0) / 1000, draft, score: scoreCase(c, draft) };
      writeFileSync(file, JSON.stringify(saved));
      console.log(`${model} ${c.id} run ${run}: ${Math.round(saved.secs)}s`);
    }
    writeFileSync(path.join(dir, "report.md"), report());
  }, 24 * 3_600_000);
});
