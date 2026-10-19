# Test plan: a real 24 GB Mac, other model families, and the 32B second run

Why: the spike's result (a 14B model with both safety passes reaches 95% of critical checks) comes from one Mac (M5 Pro, 64 GB) and
one model family (Qwen2.5). Before the requirements rely on "14B on 24 GB", we need three more facts. Everything uses the 12 invented
visits in `app/tests/eval/`. **No real patient data is used or needed.**

## What each run answers
| Run | Mac | Question |
|---|---|---|
| A | The 24 GB Mac | Does the 14B fit, how long does a note take, does the Mac start swapping? (reference model: Qwen2.5 14B) |
| B | The 24 GB Mac | Is another model family as good or better at the same size: Gemma 3 12B, Phi-4 14B? Is Llama 3.1 8B as good as the 14B? |
| C | The 64 GB Mac (this one) | A second run of the 32B with the passes, so its single run (87%) is not a guess. |

Optional if time allows: Mistral Nemo 12B, Qwen3 14B (it "thinks" before answering; the output may need its thinking mode turned off, so treat errors as setup problems, not model quality).

## Before you start (about 20 minutes, once per Mac)
1. Apple silicon Mac, macOS 14 or later, 30 GB free disk, power adapter connected, **close other apps** (browser, Word) for the measured run so the memory numbers are honest. Then repeat run A once **with Word and a browser open** to see the real-life case.
2. Install the tools:
   ```bash
   brew install ollama node
   brew services start ollama
   ```
3. Get the code onto that Mac (a copy of the Practice-management repo, or just the `Desktop App/app` folder), then:
   ```bash
   cd "Desktop App/app"
   npm install
   ```

## Run A and B: on the 24 GB Mac (about 4 to 5 hours in total; run overnight)
One command runs each model twice on all 12 visits and logs memory and swap use:
```bash
cd "Desktop App/app"
scripts/run-comparison.sh mac24gb 2 qwen2.5:14b-instruct gemma3:12b phi4 llama3.1:8b
```
Models are tried in that order, so if you stop early you still have the reference run and the strongest challenger. Expected time per model on a base chip: roughly 1 to 1.5 hours (the M5 Pro takes about 25 minutes for the 14B). The script saves partial results, so you can stop it and rerun the same command to resume.

Do not run the 32B on this Mac (it needs about 22 GB and would swap).

## Run C: on the 64 GB Mac, the 32B second run (about 40 minutes)
The first run's saved results are already in the repo, so this only fills in the second run:
```bash
cd "Desktop App/app"
mkdir -p tests/eval/results/2026-10-19-32b-second
cp tests/eval/results/2026-10-19-m5pro-64gb-passes/qwen2.5_32b_instruct__* tests/eval/results/2026-10-19-32b-second/
SPIKE_DIR=tests/eval/results/2026-10-19-32b-second SPIKE_MODELS=qwen2.5:32b-instruct SPIKE_RUNS=2 npx vitest run tests/model-compare.integration.test.ts
```
Then read `tests/eval/results/2026-10-19-32b-second/report.md` (two runs per case).

## What to record (the script does most of it)
- `hardware.txt`: chip, memory, macOS. `memory.txt`: memory the loaded model uses (`ollama ps`), swap before and after, memory pressure.
- `report.md`: the scores. `progress.txt`: seconds per note.
- By hand, for run A only: does the Mac feel usable while a note drafts (typing in Word, switching apps)? Any beach ball, fan noise or "swap used" above 1 GB in the memory file?

## How to decide
| Result | Decision |
|---|---|
| 14B on 24 GB: no swap (under about 1 GB), under 3 minutes per evaluation note, critical checks 90% or more | Keep 24 GB / 14B as the minimum (SYS-1 stays). |
| It swaps or takes much longer | Raise the minimum to 32 GB, or add a smaller-model mode only for follow-ups. |
| Another family beats Qwen2.5 14B by 3 points or more on critical checks, in both runs, and uses no more memory | Make it the default and rerun with a larger synthetic set before adopting. |
| Llama 3.1 8B scores within 2 points of the 14B | Reconsider an 18 GB tier. (Unlikely: the Qwen 7B did not hold up.) |
| 32B second run stays at or below 90% | Do not recommend the 32B even for big Macs; it is slower and no better. |

Scores are percentages over about 136 critical checks per model, so differences under about 3 points are noise. Look at the failed-check lists in `report.md` too: the same safety-relevant mistake (a dropped denial, a relative's attempt filed as the patient's, an invented dose) appearing in several runs matters more than a score.

## What to send back
The whole results folder (`Desktop App/app/tests/eval/results/<date>-mac24gb` and the 32B folder). It contains only invented visits and model drafts of them, so it is safe to share and to commit.

## Known limits of this test
- The ground truth was written by one person (an AI assistant) and has not been reviewed by a clinician.
- Twelve visits in one dialect of speech; real recordings have crosstalk, accents, speech-to-text errors and interruptions. The test starts from clean text, so real accuracy will be lower.
- It measures the language model, not the speech-to-text step. A separate test of Whisper on real-world audio (synthetic voices again, never patients) is still needed.
