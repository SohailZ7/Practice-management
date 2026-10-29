# If this becomes a product other practices buy

The owner wants to make the app available beyond this practice. That changes the architecture question from "what is
cheapest for one doctor" to "what is defensible when other people's patients are in the path". This note works through it.

## First, the two tactical questions

### Automating launch and terminate on Lambda
It can be done: Lambda has a cloud API, so the app could launch an instance when a recording starts and terminate it when
the notes are written. But automation does not fix either of the two things that actually block it:

- **The one-hour minimum.** Twelve visits scattered through a day means twelve billed hours even if each is used for three
  minutes. That is ~$341 a month against ~$24 on a per-second service. Automating the cycle makes the bill worse, not better.
- **No BAA.** Lambda publishes SOC 2 Type II and ISO 27001, and no HIPAA statement. SOC 2 is not HIPAA. Without a signed
  BAA no patient transcript can go there, at any price.

Automation is worth building anyway, but as a **provider-agnostic warm-up and shutdown step**, not Lambda-specific code.

### Warming the model while the visit is recorded
This is a good idea and it should be built. The sequence:

1. Record is pressed. The app sends a tiny warm-up request to the model endpoint, which triggers the cold start.
2. The visit runs for 10 to 30 minutes. The model finishes loading long before it is needed.
3. Stop, then Generate. The model is already warm, so there is no wait.
4. After the last note of the session, nothing is sent and the endpoint scales itself back to zero.

Two details that matter: the warm-up must be a real but trivial request, since some platforms only load the model on a
genuine inference; and the app must fall back gracefully, so a failed warm-up means a slower first note, never an error.

## The decision that actually matters for a product

**Does patient data pass through your servers, or does it stay on the customer's Mac?**

Everything else follows from that answer, and it is not primarily a technical question.

| | Model runs on the customer's Mac | Model hosted by you |
|---|---|---|
| Your HIPAA status | likely **not a Business Associate**, because you never receive PHI | **Business Associate to every customer** |
| What you must sign | nothing | a BAA with each practice, plus BAAs with every subprocessor |
| If you are breached | the customer's own device, not your systems | every customer's transcripts at once |
| What customers will ask for | that it works | SOC 2, security questionnaires, pen tests, insurance |
| Marginal cost per customer | zero | roughly $25/month, less when shared |
| Hardware the customer needs | Mac with 24 GB or more | any Mac |
| Improving the model from real use | hard: you cannot collect their notes | easy, but it is PHI you are collecting |

The asymmetry in the first four rows is the whole argument. Holding other practices' psychiatric transcripts on your
infrastructure makes you a small company with a large and very attractive pile of behavioral-health PHI, with breach
notification duties and a security program to match. Keeping the model on the customer's Mac avoids that entirely.

The economic argument does not pull the other way. One always-on L4 serves roughly 20 practices at this workload, which is
about $25 per practice per month. That is the same as scale-to-zero for a single practice, so hosting does not get much
cheaper with scale. It buys a warm model and central control, not margin.

## Recommended shape

**Local first, hosted as a deliberate option.**

1. **The desktop app does everything on the Mac by default**: recording, transcription, note writing, and files saved to a
   folder the practice owns. No PHI reaches you. This is also the honest version of the privacy claim that sells well in
   behavioral health: *your recordings and notes never leave your computer.*
2. **The model is a swappable backend** (already the plan). Local is the default; a hosted endpoint is configuration.
3. **Offer hosting only as a separate, clearly scoped service** for practices whose hardware cannot run a 14B model, with
   its own BAA and its own price. Keep it opt-in so most customers never put you in the PHI path.
4. **Keep the practice-management web app separate.** It holds PHI by nature, so if it is sold as a service you are a
   Business Associate regardless. That is a different product with a different compliance burden, and bundling the two
   would drag the desktop app's clean position down with it.

## What this costs you, honestly
- **A hardware floor.** Local means a Mac with 24 GB or more. That rules out some buyers. The model comparison now running
  is partly about how far down that floor can go.
- **Model improvement gets harder.** You cannot gather customers' notes to fine-tune on; that is their patients' data.
  What you can do instead: ship better prompts and templates in app updates, collect **opt-in, content-free** signals such
  as which checks failed and which sections were edited, and fine-tune on this practice's own data under its own roof.
- **Support is harder** when the software runs on machines you cannot see. Build in a diagnostics report that contains no
  patient content.

## Things to settle before selling to anyone
1. A lawyer's read on whether the local-only version makes you a Business Associate. My reading is that it does not, but
   that question is worth real legal advice, not mine.
2. Whether the desktop app and the web app are sold together or apart.
3. Who holds the liability when an AI-written note contains an error. The DRAFT marker and mandatory review exist for this
   reason, and the terms of sale should match what the software actually does.
4. Apple Developer account and signing, which is needed before anyone else can install it at all.
