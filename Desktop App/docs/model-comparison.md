# Local model comparison (spike, 2026-10-19, second round)

Question: which local model should write the note drafts, and what goes wrong?

## Method
- Hardware: Apple M5 Pro, 64 GB. Ollama, temperature 0.1, 16k context, 2 seeded runs per case.
- Models: qwen2.5 instruct 7B (4.7 GB), 14B (9 GB), 32B (19 GB). Same prompts and rules for all (`app/src/lib/pipeline.ts`).
- **12 synthetic cases** (`app/tests/eval/`): 5 evaluations, 4 follow-ups and 3 discharges, the last 7 with an invented earlier note.
  They include traps: the doctor proposes a dose and the patient only agrees; a spouse's collateral report; a sister's suicide
  attempt; a declined sleeping pill; a lab value; a stopped drug versus a continued one; an old dose versus the new one; a
  patient who refuses medication at discharge; and one visit where almost nothing is said.
- **Scoring (improved):** 150+ checks with ground truth, split into *facts found* (a stated fact appears in the right section),
  *no wrong statements* (misattribution, wrong dose, wrong person) and *no inventions* (a topic never raised must read "not
  discussed"). Checks marked critical are the safety-relevant ones (suicide risk, doses, who said what, declined drugs).
  An "unsupported words" rate gives a rough sense of invented wording. Scores are recomputed from saved drafts.
- The checks are patterns, not a clinician's judgment. After the first run I read the failing drafts, fixed eight checks that were
  wrong (negation, word order, "none" versus "denies"), and rescored all models with the same fixed checks. Treat percentages as
  a guide; the error list below is more informative.

## Results (24 notes per model; the 7B and 14B are close, the 32B is slower)
| Model | Facts found | No wrong statements | No inventions | Critical checks | Time per note |
|---|---|---|---|---|---|
| 7B | 94% | 92% | **83%** | 89% | 11 s |
| 14B | 91% | **95%** | 92% | **92%** | 20 s |
| 32B | 92% | 92% | **100%** | **92%** | 44 s |

By note type (critical checks): evaluations 7B 82%, 14B 91%, 32B 94%; follow-ups 94% / 94% / 91%; discharges 97% / 91% / 88%.
With 136 critical checks per model, differences of a few points are within noise. **No model was reliably safe.**

## What the larger models changed, and what they did not
- **Bigger models invented less.** The 7B put "feeling sad" under *Suicidal thoughts* when suicide was never asked about, wrote a
  Xanax dose nobody stated, and wrote "denies any impact on functioning". The 32B made no inventions in this set.
- **Bigger did not mean more complete or better attributed.** The 32B attributed the spouse's report about the truck purchase to
  the patient, wrote "safety plan: not discussed" when one was reviewed, and dropped the lithium level. The 14B and 32B dropped
  the lithium blood level and thyroid result; the 7B kept more facts (highest recall) but misfiled more.
- **Errors every model made** (so a prompt or pipeline problem, not a size problem):
  - The patient's *denial* of suicidal or homicidal thoughts in a visit was recorded as "not discussed" (E2, all three models).
  - A **family member's suicide attempt was filed under the patient's own attempts or behavior** (E3, all three models).
  - Old facts from the earlier note were sometimes dropped (allergy) or the old dose was not shown beside the new one.
  - The treatment plan section sometimes merged a doctor's proposal with what the patient agreed to.

## Implications for the app
1. **Keep mandatory review** and the "not discussed" and ungrounded-value flags. They matter more than model size.
2. **Do not rely on one free-text pass for the suicide-risk section.** Ask it as separate yes/no questions (wish to be dead, thoughts,
   method, intent, plan, behavior, protective factors) and keep denials; run a second "who said this" check for any line about
   family, a spouse or other people.
3. **Add a verification pass** (a second prompt that must quote the transcript line supporting each sentence; unsupported sentences
   are flagged) and, if the audio allows, speaker labels from the transcriber, so "doctor said" and "patient said" stop being guesses.
4. **Default model:** the 14B is the best balance of speed (about 20 s) and safety here and fits an 18 GB Mac with room to spare; the
   32B (about 20 GB, 45 s) is a reasonable choice on 32 GB or larger Macs because it invented nothing. The 7B is a fallback.
5. Next: try other model families and the verification pass, enlarge the set with a clinician's review of the ground truth, and
   run it on an actual 18 GB Mac.

## Failed checks by model (runs failed / runs)
### qwen2.5:14b-instruct
- D2/sleep-7: 1/2  (sleep)
- **CRITICAL** D2/no-si-hi: 2/2  (risk)
- D2/allergy-carry: 2/2  (carried-forward allergy)
- **CRITICAL** D3/no-si: 1/2  (risk)
- D3/numb: 1/2  (reason)
- E1/no-hosp: 2/2  (denial recorded, not left blank)
- E1/no-depression-medhx: 2/2  (psychiatric or family item invented under medical history)
- E2/sleep: 2/2  (sleep amount)
- **CRITICAL** E2/no-si: 2/2  (denies SI/HI)
- **CRITICAL** E3/sister-not-patient-attempt: 2/2  (sister's attempt attributed to patient)
- E3/no-hosp: 2/2  (denial recorded)
- **CRITICAL** E5/nd-si-thoughts: 2/2  (never asked)
- F1/current-50: 2/2  (current dose)
- F2/four-weeks: 1/2  (interval)
- **CRITICAL** F3/level-0.8: 2/2  (lab value)
- F3/thyroid-normal: 2/2  (lab result)

### qwen2.5:32b-instruct
- **CRITICAL** D1/no-si-2w: 2/2  (risk statement)
- D2/home-wife: 2/2  (disposition)
- D2/allergy-carry: 2/2  (carried-forward allergy)
- **CRITICAL** D3/no-si: 2/2  (risk)
- **CRITICAL** E1/lisinopril: 2/2  (dose kept)
- E1/no-depression-medhx: 2/2  (psychiatric or family item invented under medical history)
- E2/sleep: 2/2  (sleep amount)
- E2/truck-attrib: 2/2  (spouse's collateral attributed to the patient)
- **CRITICAL** E3/sister-not-patient-attempt: 2/2  (sister's attempt attributed to patient)
- F1/current-50: 2/2  (current dose)
- F2/missed-two: 1/2  (adherence)
- **CRITICAL** F3/level-0.8: 2/2  (lab value)
- F3/thyroid-normal: 2/2  (lab result)
- **CRITICAL** F4/no-plan: 1/2  (no plan)

### qwen2.5:7b-instruct
- D2/allergy-carry: 2/2  (carried-forward allergy)
- **CRITICAL** D3/no-si: 1/2  (risk)
- D3/numb: 1/2  (reason)
- D3/therapy-brooks: 1/2  (referral)
- **CRITICAL** E1/nd-firearms: 2/2  (not discussed, must not be invented)
- E2/sleep: 2/2  (sleep amount)
- **CRITICAL** E2/no-si: 2/2  (denies SI/HI)
- E2/no-invented-functioning: 2/2  (invented denial)
- **CRITICAL** E3/sister-not-patient-attempt: 2/2  (sister's attempt attributed to patient)
- **CRITICAL** E3/xanax-dose-invented: 2/2  (dose never stated)
- E3/albuterol: 1/2  (current medication)
- **CRITICAL** E4/no-intent-today: 2/2  (intent statement kept as said)
- **CRITICAL** E5/nd-si-thoughts: 2/2  (never asked)
- F2/missed-two: 2/2  (adherence)
- **CRITICAL** F4/no-plan: 2/2  (no plan)

---

# Round 3: suicide-risk questions and a verification pass (2026-10-19)

Two passes were added to the drafting pipeline (`app/src/lib/passes.ts`) and the 12-case set was rerun.

1. **Suicide-risk questions.** Each C-SSRS line is its own question the model must answer YES, NO or NOT_ASKED, with a one-sentence
   statement and a quote from the transcript. A denial is recorded; "protective factors" and "safety plan" can only be YES or
   not discussed; "does not report ..." is treated as an absence, not a statement.
2. **Verification.** Each drafted sentence is checked against the transcript (and prior note): supported or not, who it is about
   (patient, family, other person, doctor's plan), who said it. Unsupported sentences and sentences about someone other than the
   patient in a patient-history section are **removed from the note but shown to the provider with a Restore button**. A
   collateral report written as the patient's is relabeled ("Another person present reports ..."). Spelled-out numbers are shown
   to the verifier as digits too.

Two defects found while building this (and fixed): an answer parser that read "NOT_ASKED" as "NO", and a verifier that removed true
lines because it did not equate "two" with "2". Both are covered by tests.

## Results (same 12 cases, same final checks; baseline rescored)
| Model | Runs | Critical checks, before | Critical checks, with passes | No wrong statements | No inventions | Time per note with passes |
|---|---|---|---|---|---|---|
| 7B | 2 | 89% | 88% | 95% | 79% | 25 s |
| 14B | 2 | 92% | **95%** | **97%** | 96% | 52 s |
| 32B | 1 | 92% | 87% | 95% | 83% | 122 s |

- **14B:** the passes helped. The two errors every model shared are gone (the patient's own denial of suicidal thoughts in the manic
  visit is recorded; the sister's attempt is no longer filed under the patient's own history). Evaluations reached 97% of critical checks.
- **7B:** no net gain. It cannot reliably check its own work: it still filed the sister's attempt as the patient's, kept an invented
  Xanax dose, and recorded things in a visit where almost nothing was said.
- **32B:** one run only, so inconclusive. It did worse than before on suicide-risk lines in the nearly empty visit and on two
  denials, which suggests the question prompts need tuning for it. Not a reason to prefer it: it is also 2.5 times slower than the 14B.
- **Still failing for the 14B:** dropped details (the lithium level and thyroid result, a carried-forward allergy, "denies harm" in two
  discharges), and one of two runs on the nearly empty visit still wrote a suicide-risk line that was never discussed.

## Minimum model and computer (recommendation)
Measured: the 14B model loaded at 16k context uses **10 GB** of memory (Ollama), the 7B about 5.5 GB, the 32B about 22 GB. The
transcriber needs about 1 GB and runs before the language model loads. Everything below the measured figures is an estimate.

| | Recommendation |
|---|---|
| **Minimum model** | A 14B-class instruct model (tested: Qwen2.5 14B) **with both passes on**. It is the only tested setup above 90% on safety checks. The 7B is not recommended for patient notes. |
| **Minimum computer** | Apple silicon Mac (M2 or newer), **24 GB** memory, macOS 14 or later, 30 GB free disk, FileVault on. |
| **Comfortable** | 32 GB or more, a Pro or Max chip. Room for Word and a browser beside the model, and faster drafts. |
| **18 GB** | Not recommended. The model plus macOS, Word and the app leaves little headroom, so it would swap and slow down. Not tested on real hardware. A 7B fallback exists but is the weakest option for risk-bearing text. |
| **Speed** | About 50 s per note on an M5 Pro with 64 GB (evaluations about 75 s, follow-ups and discharges about 35 s). Base M-series chips have roughly a third to half of the memory bandwidth, so expect roughly 2 to 3 times longer, about 2 to 3 minutes per evaluation. Fine for drafting after a visit, not for waiting on. |

Before relying on this: run the same test on a real 24 GB Mac, test one or two other model families, and have a clinician check the
ground truth.
