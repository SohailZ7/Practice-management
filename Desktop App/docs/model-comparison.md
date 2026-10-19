# Local model comparison (spike, 2026-10-19)

Question: which local model should write the note drafts, and does a larger one help?

## Method
- Hardware: Apple M5 Pro, 64 GB. Ollama, temperature 0.1, 16k context, fixed seeds, 3 runs per model per transcript.
- Models: qwen2.5 instruct 7B (4.7 GB), 14B (9 GB), 32B (19 GB). Same prompts and rules for all (`src/lib/pipeline.ts`).
- Two **synthetic** transcripts: (1) a short visit where the doctor proposes raising a dose (speaker-attribution trap), made with
  macOS speech and transcribed by whisper.cpp; (2) a longer depression evaluation with family history, a denied history,
  a medication, a declined sleeping pill and side-effect counseling.
- Automated checks of known facts (`tests/model-compare.integration.test.ts`), plus reading the drafts by hand. The checks are
  keyword patterns, so they miss some errors (for example an invented diagnosis in the wrong section) and can fail on valid wording.

## Scores (checks passed, 3 runs each)
| Model | Transcript 1 (dose attribution) | Transcript 2 (full evaluation) | Time per Psych Eval draft |
|---|---|---|---|
| 7B | 26/27 | 54/54 | 14-23 s |
| 14B | 27/27 | 51/54 | 26-40 s |
| 32B | 27/27 | 51/54 | 57-76 s |

## What reading the drafts showed (more reliable than the scores)
- **Speaker attribution** was fixed for all three models by an explicit rule (doctor proposes, patient agrees). Before the rule,
  the 7B wrote that the patient requested the dose increase.
- **7B:** good on the easy facts, but mislabeled content (put "denies thoughts of harming themselves" under past attempts) and
  copied first-person words ("None that I know of").
- **14B:** invented "Depression, hypertension" under medical history and omitted the denied hospitalization. Not better than the 7B here.
- **32B:** most faithful to the labels (filled the four C-SSRS lines correctly). Dropped the lisinopril dose and put a family
  history of depression under the patient's medical history.
- **No model was error-free.** Every error above would have been caught only by review, which the app requires.

## Conclusions and limits
- Size is not a guarantee: 14B was no better than 7B on this sample. Two transcripts are a small sample.
- 32B gave the best drafts but takes about a minute per evaluation and needs about 20 GB free, so it fits 32 GB and larger Macs, not 18 GB.
- Suggested defaults: 32B where memory allows, otherwise 7B or 14B; always mandatory review; keep the "not discussed" and ungrounded-value flags.
- Next: a wider synthetic test set (10+ transcripts, including follow-ups with a prior note and discharges), a better scoring method
  (checks per label, reviewed by a clinician), and testing other model families before fixing a default.
