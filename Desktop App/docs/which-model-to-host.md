# Which model to run

**The owner's plan: phase 1 runs the model on the provider's own Mac. Phase 2 moves it to GCP. The target machine is an
M4 MacBook Air with 24 GB.** For phase 1 the machine, not the hosting bill, decides which models are candidates.

## The target machine: M4 MacBook Air, 24 GB

24 GB is more comfortable than 18 GB, and memory stops being the binding constraint. Two other properties of this
machine matter more.

### Memory
| | |
|---|---|
| macOS | ~4 to 6 GB |
| The app, Word, a browser | ~2 to 3 GB |
| **Left for the model** | **~15 to 17 GB** |

| Model | Size on disk | On a 24 GB Air |
|---|---|---|
| Gemma 3 12B | 8.2 GB | comfortable |
| Qwen2.5 14B | 9.0 GB | comfortable |
| Phi-4 | 9.1 GB | comfortable |
| Qwen3 14B | 9.3 GB | comfortable |
| gpt-oss 20B | 13 GB | fits, some headroom |
| MedGemma 27B | 17 GB | no: nothing left for anything else |

So five of the six are genuinely available, and only MedGemma is out. Whisper (about 1 GB) is unloaded before the note
model loads, so it is not in this budget.

### Speed is the real constraint, not memory
Token generation on Apple silicon scales with memory bandwidth. The base M4 in the Air has roughly 120 GB/s against about
300 GB/s on the M5 Pro these tests ran on: **about 2.5 times slower.** Carrying the measured times across:

| Model | Measured here | Estimated on an M4 Air | A 4-document visit |
|---|---|---|---|
| A 12B to 14B model | ~52 s per note | **~2 minutes** | **~9 minutes** |
| MedGemma 27B | ~180 s per note | ~7.5 minutes | ~30 minutes |

Treat these as estimates: the bandwidth figures are from memory and nothing has been measured on an Air. They are close
enough to show the shape of the problem.

### The Air has no fan
It is passively cooled, so sustained load throttles. Writing four documents is several minutes of continuous GPU work,
which is exactly the case where an Air slows down. The figures above may be optimistic on a warm machine.

### What this means for the design
**Generation must not block the provider.** A visit that produces four documents takes minutes, and the provider cannot
wait on it between patients. So:

- Pressing **Generate queues the work** and returns immediately. The provider moves to the next patient.
- The row shows progress, and the file icons appear as each document is finished.
- The queue survives moving between days, and ideally a restart.
- Documents are generated **one at a time**, since two models at once would not fit memory anyway.
- The 27B is effectively out for phase 1 on this hardware, on speed as much as memory.

This also makes the smaller models more interesting than their scores alone suggest: Gemma 3 12B is both the smallest and
the fastest of the candidates, so if it scores close to the 14B models it may be the better choice on an Air.

---

# Hosting (phase 2)

Question from the owner: if the note-writing model is hosted on GCP, which model should it be?

Cost is driven almost entirely by **how much GPU memory the model needs**, because that decides how many GPUs the server
must keep running. Quality is measured on the 12 synthetic visits in `app/tests/eval/`. This document puts the two together.

## The cost tiers

A model's memory need at 4-bit is roughly `parameters x 0.55 GB per billion`, plus 1 to 4 GB for the context window.
That sorts every candidate into one of four tiers:

| Tier | Model size | Memory at 4-bit | GPU needed | Rough GCP cost |
|---|---|---|---|---|
| **A** | up to ~27B | 5 to 18 GB | one L4 (24 GB) | **~$0.70/hour** → about $510/month running all the time, ~$155/month for clinic hours only |
| **B** | ~32B | ~19 GB + context | one L4, tight | same as A, but no headroom for a longer context |
| **C** | ~70B | ~40 GB | one A100 80 GB | ~$5/hour → about $3,600/month, ~$1,100/month clinic hours |
| **D** | 120B and up | 65 GB and up | several H100/H200 | $28,000/month and up (see the GLM 5.2 note below) |

GPU prices are approximate: Google's pricing page would not load, so these come from third-party summaries. The ratios
between tiers are what matter, not the cents.

**The practical conclusion is already visible in the shape of this table.** Everything from 8B to 27B costs the same to
host, because it all fits one L4. So within tier A there is no reason to pick a smaller model: pick the *best* one that
fits. The only real money question is whether tier C or D buys enough quality to justify 7x or 55x the cost.

## Why GLM 5.2 is not a candidate
It is a 744B-parameter mixture-of-experts model. Its FP8 weights alone are about 744 GB, so vLLM's own recipe calls for an
8xH200 node; an INT4 build still needs about 372 GB. That is roughly **$28,000 to $62,000 a month**, against a workload of
about 40 documents a day that would leave the machine idle almost all the time. Its advertised strengths, long-horizon
coding and a 1M-token context, are not what this task needs.

Its API would cost $40 to $100 a month instead, but Z.ai is a Chinese company with no BAA, so patient transcripts cannot
go there. A US provider hosting the weights could work only if they sign a BAA.

## What is being tested
All candidates are open-weight and self-hostable. One run of the 12 cases each, with both safety passes on, scored the
same way as before (`docs/model-comparison.md`).

| Model | Size | Tier | Why it is in the test |
|---|---|---|---|
| Qwen2.5 14B Instruct | 14B | A | the current best: 95% of critical checks |
| Qwen3 14B | 14B | A | the next generation of the model that won |
| Gemma 3 12B | 12B | A | Google, a different family at the same cost |
| Phi-4 | 14B | A | Microsoft, trained differently, strong for its size |
| gpt-oss 20B | 20B MoE | A | OpenAI's open-weight model |
| MedGemma 27B | 27B | A | **medically tuned**: the most interesting question here |
| Llama 3.3 70B | 70B | C | does paying 7x more actually buy anything? |

A note on the medical model: a medical fine-tune is not obviously better for this job. These models are usually tuned to
*answer* clinical questions from their own knowledge, and this task needs the opposite, taking only what was said and
inventing nothing. It may well be worse. That is worth knowing either way.

## Sporadic use changes the cost, and the shortlist

The owner expects the model to be busy only one or two hours in a day. Cloud Run supports GPUs that **scale to zero**, so
nothing is paid while no note is being written. At the listed L4 rate of $0.0001867 per second (about **$0.67 an hour**):

| How it is run | Billed time | Cost |
|---|---|---|
| Scale to zero, cold start on every visit | ~1.9 h/day | **~$28/month** |
| Scale to zero, warmed when Record is pressed | ~1.6 h/day | **~$24/month** |
| Kept warm through clinic hours (8am-6pm) | 10 h/day | ~$148/month |
| Always on | 24 h/day | ~$484/month |

Based on 12 visits a day, 22 clinic days, about 3 minutes of generation per visit and Cloud Run keeping the instance
alive a few minutes after the last request. CPU, memory and storage are billed on top, but they are small next to the GPU.

**The cold start, and how to hide it.** A cold start loads the model into GPU memory. Google's own example reached a first
token in about 19 seconds for a 4B model; a 9 GB model will take longer, and one developer measured around 105 seconds.
That is a long wait for the first note of the morning.

It does not have to be felt. **Start the model loading the moment Record is pressed.** The visit then runs for 10 to 30
minutes, and generation only begins when the provider presses Generate, by which time the model is long since loaded.
The cold start disappears into the appointment, and the app never waits.

**Two things to know before relying on this:**
- Google's documentation says the GPU is billed for the **whole instance lifetime**, not only while a request is being
  processed. A third-party guide claims per-request billing; trust Google's wording. It means the idle timeout is part of
  the bill, which the figures above already assume.
- **Cloud Run allows one L4 per instance.** That caps the model at roughly 27B. Tier C and D models cannot run this way at
  all; they need a Compute Engine VM or Vertex endpoint, neither of which scales to zero as cleanly.

**What this settles.** At about $25 a month, cost stops being a reason to choose between models in tier A. The 70B tier
remains genuinely expensive because it cannot use the cheap serverless path. So the shortlist is: **the best model that
fits one L4**, and the Llama 70B run is now only there to show what, if anything, is being given up.

## Results: six models, 12 synthetic visits, one run each

Run on an M5 Pro with 64 GB, both safety passes on, scored by the checks in `app/tests/eval/`.

| Model | Size | Critical checks | No wrong statements | No inventions | Facts found | Median time per note |
|---|---|---|---|---|---|---|
| **Qwen2.5 14B Instruct** | 9.0 GB | **96%** (65/68) | **97%** | **100%** | 92% | 90 s |
| Qwen3 14B | 9.3 GB | 93% (63/68) | 97% | 92% | 94% | **86 s** |
| MedGemma 27B | 17 GB | 91% (62/68) | 92% | 92% | **97%** | 194 s |
| Phi-4 | 9.1 GB | 85% (58/68) | 86% | 92% | 94% | 110 s |
| Gemma 3 12B | 8.2 GB | 84% (57/68) | 89% | 83% | 90% | 94 s |
| gpt-oss 20B | 13 GB | *incomplete* | | | | *1039 s* |

By note type, critical checks: Qwen2.5 14B scores 97% on evaluations, 94% on follow-ups and 94% on discharges, the only
model above 90% in all three. Gemma 3 12B collapses on discharges (71%), and Phi-4 is weakest on follow-ups (82%).

### Caveats, which matter here
- **One run per model.** With 68 critical checks, a gap of three or four points is noise. Qwen2.5 at 96% and Qwen3 at
  93% are not separated by this test; Qwen2.5 at 96% and Gemma 3 at 84% are.
- **gpt-oss 20B did not finish.** It timed out after three cases, and at about 17 minutes per note it is far too slow for
  this work regardless of quality. Not a candidate for a MacBook Air.
- **Timings are medians, not averages.** Several runs stalled for 20 to 30 minutes for reasons unrelated to model speed,
  which made the averages meaningless. Medians are the honest figure, and even they are from a 64 GB M5 Pro; an M4 Air
  will be roughly 2.5 times slower.

### The medical model did not win
MedGemma 27B came third. It found the most facts of any model (97%), which is what a medically tuned model should be good
at, but it was beaten on the three measures that matter for safety: wrong statements, inventions and critical checks. That
matches the prediction in `docs/model-comparison.md`: a model tuned to produce clinical content is not what this task
needs, because the task is to take only what was said. It is also 17 GB and twice as slow, so it cannot run on the
target Air at all.

## Recommendation

**Phase 1: Qwen2.5 14B Instruct.** It is the incumbent and it is still the best. It leads on every safety measure, it is
the only model above 90% across all three note types, it fits a 24 GB Air at 9 GB, and it is among the fastest tested.
Apache 2.0, so there is no licensing obstacle to shipping it.

**Keep Qwen3 14B as the alternative.** It is statistically indistinguishable here and slightly faster. If a confirming run
separates them, take the winner.

**Before committing, two things are worth doing:**
1. **A second and third run of Qwen2.5 14B and Qwen3 14B.** One run cannot separate 96% from 93%, and this decision
   deserves better than a coin flip. About an hour of compute.
2. **A run on the actual M4 Air.** Everything above is from a 64 GB M5 Pro. The Air's speed, and whether it throttles
   during a four-document visit, is the open question that no amount of testing here can answer.

Phase 2 reopens the choice, because hosting lifts the memory and speed limits. MedGemma would deserve another look then,
as would larger models, measured against whatever Qwen2.5 14B is achieving in production by that point.
