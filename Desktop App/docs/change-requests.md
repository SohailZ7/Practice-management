# Desktop App: change requests log

A running list of changes the owner asks for while going through the app. **Nothing here is built until the owner says "build it".**
When that happens these become the next `specs/requirements-vN.md` (full copy plus a "Changes since" section) and are built in small, tested steps.

Status values: `noted` (not built), `building`, `built`.

## 1. Remove the Dictate flow; every row is just Record
- Date asked: 2026-10-28
- Status: noted
- Request: remove "Dictate note". Every schedule row shows only **Record**. The patient consent flow will be added back later.
- Effect on the app: the Record button no longer depends on consent. No "Dictate note" button, no dictation wording on the capture screen, and the dictated-summary option in the drafting step goes away. The "consent on file" text in the note's encounter section is not written (it would be untrue while consent is not tracked).
- Not affected: the web app's consent and Desktop API work stays as built; it is simply not used by the desktop app for now.
- To confirm when building (my assumptions):
  - Consent badges on the board are hidden until the consent flow returns.
  - Canceled, absent and missed rows still get no Record button.
  - A row with no linked patient still gets Record, and the app asks for the patient's name to make the folder.
  - Requirements v2 items that depend on consent (CON-*, SCH-4, the "consent on file" source line) are marked deferred, not deleted.

## 2. Real schedule: replaced by request 4 (paste flow)
- Date asked: 2026-10-28
- Status: superseded by request 4
- Owner's answers: a row with "Follow-up & Discharge Order" produces **both** a follow-up note and a discharge summary; client rows with no provider selected are left out; only rows for Dr. Khalid Ahmed are shown.
- Because the owner chose a paste flow, no patient data is put in the repo or in source files. Pasted schedules are stored only in the app's own data folder on the Mac, outside git.

## 3. Remove the three header pills
- Date asked: 2026-10-28
- Status: noted
- Request: remove the pills at the top of the screen: "Spike · synthetic schedule", "Transcription" and "Language model: <model name>". (The "Fake engines (browser)" pill only appears in the browser test version; it goes too.)
- Effect: the header shows just the app name. The model dropdown above the schedule stays, so the model can still be chosen. The engine-ready indicators go away, so if Whisper or the model is missing the only sign is that Record is disabled, with the existing banner explaining why.
- Not affected: the consent badges next to patient names (handled by request 1).

## 4. Paste a day's schedule into the app
- Date asked: 2026-10-28
- Status: noted
- Request: a flow where the owner pastes the day's board (copied from the Excel sheet, tab-separated, columns Time / Type / Client Info / Absent / Canceled / Provider / Completed / Missed / Sent to Team) and it loads for the selected date.
- Rules: keep only rows whose provider is the configured provider (Dr. Khalid Ahmed, set in Setup); skip rows with no client, placeholder rows ("Select Time", "Select Track", "Select Order") and rows with no provider selected. Track rows carry the program in the first column (for example KPHP-AM 9:00 - 12:30). Re-pasting a date replaces that date.
- Parsing: client text like `Name/Age+Sex/Insurance/Note` gives the patient name; nicknames in quotes are dropped from the folder name; age, sex and insurance are kept for display only.
- Storage: the app's data folder, never the repo (see request 2).

## 5. Date bar: arrows plus a calendar
- Status: noted
- Request: `<  date  >` with previous/next buttons and a calendar picker to jump to any date.

## 6. Row flow: Record, Stop, Generate, then file icons
- Status: noted
- Request: the Record button turns into Stop; after Stop a Generate button appears. Generate writes the documents for that appointment type into the patient's folder. The row then shows an icon for each generated file. Clicking an icon opens the file in a modal pop-up; the modal also has a button that opens the folder in Finder.
- **Documents per appointment type** (owner, revised: produce **both** the Fairfax form and the Word master template note). The appointment type names the documents:
  | Appointment type | Documents generated |
  |---|---|
  | Psych Eval & Admit Order | Psych Eval note (Word master) + Admit order form |
  | Follow-up | Progress note form (Fairfax 4071) + Follow-up note (Word master) |
  | Follow-up & Admit Order | Progress note form + Follow-up note + Admit order form |
  | Follow-up & Discharge Order | Progress note form + Follow-up note + Discharge order form + Discharge summary (Word master) |
  | DC Orders Only | Discharge order form + Discharge summary (Word master) |
  So a visit yields a form and a narrative note side by side: the form is what the hospital files, the narrative note is the fuller record. Open: confirm the discharge rows, which pair the order form with the Word discharge summary by the same logic (my assumption, not something the owner said). **Owner confirmed: generate the orders too.** Each order form is filled only with what the recording supports; the rest stays blank for the provider, and the blank fields are named in the "Needs your attention" list.
  Note: a "Follow-up & Discharge Order" row now generates four documents from one recording. Drafting time adds up, roughly 35 to 50 seconds per document on this Mac.
- Order documents: the owner pointed to `~/Documents/B&B Center/Documents/Templates`. What is there (looked at 2026-10-28):
  - `Admit order example` (PDF and PNG): the practice's "Admit to Outpatient Program" form.
  - `Discharge order example.pdf`: Fairfax Behavioral Health "Physician Discharge Order", form 4012 rev. 10/19.
  - `Progress note example.pdf` and `Progress note example 1.pdf`: Fairfax Behavioral Health "Psychiatrist Progress Note", form 4071 rev. 07/24, 2 pages.
  - Also copies of the two Word files already in the repo.
- Three findings that change the plan:
  1. **They are filled-in, handwritten scans carrying real patient names and the provider's signature, not blank templates.** They stay where they are: never copied into the repo, never used as test data. Blank originals are needed (ideally the editable form files from Fairfax).
  2. **They are checkbox forms, not prose.** Filling them means ticking boxes and writing short entries, which is a different job from writing narrative sections into the Word master template. A scanned image cannot be filled by software; it needs the blank form, preferably a fillable PDF.
  3. **The Fairfax progress note form overlaps the Word master template.** Both cover a follow-up visit. Which one a Follow-up row should produce is an open question for the owner.
- Much of what these forms ask for (labs to order, diet, prognosis, discharge disposition) is a clinical decision that a recording will not contain. Proposal: fill only what was actually said and leave the rest blank for the provider.
- **Review moves into the document** (owner asked how this works; proposal below, awaiting a yes):
  - Generate writes each file straight to the patient's date folder. No review screen.
  - **File name starts with the patient's name**: `<Last, First> 2026-10-28 Follow-up DRAFT.docx`. (Owner's request; the patient folder already carries the name, so this repeats it inside the file name on purpose, which helps when files are attached or moved.)
  - The first line of the document reads: "DRAFT. Written by AI from the visit recording. Not reviewed. Check every section, then delete this line." A document is only "reviewed" once a person deletes that line, which the app cannot do for you.
  - Lines the app is unsure about stay highlighted yellow, as they are now.
  - A "Needs your attention" section at the end of the document lists, in one place: lines the verification pass removed and why, lines whose supporting words were not found in the recording, and the sections the recording cannot fill (mental status exam, review of systems, formulation, diagnoses, attestation).
  - The suicide-risk and medication sections are listed there first, since those were the two that required a tick before saving.
  - The row shows a small "draft" marker on the file icon. **A "Mark reviewed" button on the row (owner asked for it)** renames the file to drop `DRAFT`. The app never rewrites a file after generating it, so edits made in Word are safe.
- Modal: read-only preview with Open in Word and Show in Finder. **Confirmed by owner.**

## 7. Setup tab
- Status: noted
- Request: a Setup screen asking for configuration: where the models are (transcription model file, language model name), the master folder for saved files, and (assumed) the provider whose rows to show and the templates folder.

## 8. Folder structure: Master folder, Patient, Date
- Status: noted
- Request: `<master folder>/<Patient name>/<date>/` holding the recording file, the transcript and the generated documents.
- **Owner's decision: delete the recording, keep the transcript.** So each date folder holds the transcript and the generated documents; the audio is shredded after transcription, as requirements v2 REC-2 already says. (The earlier reading of this request, that the audio file is kept, was wrong.)
- Changes an earlier decision: notes are no longer one file per visit in the patient folder, so looking up a patient's previous note for follow-ups and discharges must search the date folders and take the most recent one before today.
- The master folder should sit on an encrypted disk (FileVault), since transcripts and notes are patient records.

## 9. Rebuild the practice's forms as Word templates
- Date asked: 2026-10-28
- Status: **built** (blank forms in `Templates/forms/`, regenerated by `Templates/forms/build_forms.py`)
- Request: there are no blank originals, so recreate the practice's forms as Word documents from the filled scans, and use those as the app's templates.
- Forms to rebuild: Psychiatrist Progress Note (Fairfax form 4071 rev. 07/24, 2 pages), Physician Discharge Order (Fairfax form 4012 rev. 10/19), Admit to Outpatient Program order.
- Only the **printed structure** is copied: headings, field labels, checkbox lists, tables. Nothing handwritten and no patient detail from the scans goes into the templates or the repo.
- Two things the owner should know:
  - These are Fairfax Behavioral Health's forms. A Word recreation is not the official form and may not be accepted in place of it by the hospital's medical records. Ask Fairfax for the blank originals, ideally fillable PDFs, and the app can fill those instead.
  - The handwriting on the scans is only partly legible, so anything read from it is a best effort and is marked as uncertain.

## 10. Learn Dr. Ahmed's filling style from the examples
- Date asked: 2026-10-28
- Status: **written up** in `docs/form-filling-style.md`
- Request: read the filled examples to learn how Dr. Ahmed fills these forms, and use that to decide how transcript content maps into each field.
- Limits to be honest about: three or four examples, mostly handwriting, several entries not clearly legible. That is enough to learn conventions (which boxes he ticks, how short his entries are, what he leaves blank), not enough to learn clinical judgment.
- The examples carry patient names and signatures. They are read in place, never copied into the repo, and what is learned is written down as style rules only, with no patient detail.
## 11. Ship as a single standalone installable
- Date asked: 2026-10-28
- Status: noted, plan written in `docs/packaging-plan.md`
- Request: the app should be one installable that includes everything, with no Homebrew, no terminal and no separate Ollama.
- Plan in short: drop ffmpeg (record to WAV in Rust with cpal), link Whisper in with whisper-rs, replace Ollama with embedded llama.cpp (llama-cpp-2), bundle the templates, and download the model weights on first run rather than putting 9.5 GB inside the installer. Result: an 80 to 120 MB signed `.dmg` plus a one-time model download.
- Needs an Apple Developer account ($99/year) for signing and notarization; without it macOS warns every provider that the app is damaged or untrusted.
- Decisions for the owner: embedded llama.cpp versus keeping Ollama as a prerequisite; where the models are hosted (the practice's own bucket, Hugging Face, or an offline copy); and whether to buy the Apple account now.
- **Owner: the model will eventually be hosted on GCP.** That makes packaging easier: the installer carries the app, Whisper and the templates, and the first-run download falls from 9.5 GB to 470 MB, with no 24 GB memory requirement.
- Revised order of work: build the model backend as a switch (local or hosted) now, keep Ollama for local development, **do not embed llama.cpp yet**, and package once the hosted endpoint exists. Embedded llama.cpp is built only if notes must be written with no internet.
- Open: must notes be written offline, or is "record and transcribe offline, write the note when the network returns" enough?

## 12. Two phases: local model first, GCP hosting second
- Date asked: 2026-10-28
- Status: noted
- **Phase 1:** the model is downloaded and runs on the provider's Mac. **Target machine: M4 MacBook Air, 24 GB.**
- **Phase 2:** the model moves to GCP (Cloud Run GPU, scale to zero, warmed when Record is pressed).
- Memory on a 24 GB Air: about 15 to 17 GB is left after macOS and the usual apps, so every candidate fits except MedGemma 27B (17 GB).
- **Speed, not memory, is the constraint.** The base M4 has roughly a third of the M5 Pro's memory bandwidth, so expect about 2 minutes per note and about 9 minutes for a four-document visit, and the Air has no fan, so sustained generation will throttle. Estimates, not measured on an Air.
- **Therefore generation must be a background queue** (see request 13), not something the provider waits on.
- Requirements v2's 24 GB minimum (SYS-1) matches the target machine, so it stands. SYS-4's "under 2 minutes per note" was written for a Pro chip and needs revising for an Air.
- The packaging plan assumed hosting, so phase 1 brings back the larger first-run download (the model, about 8 to 9 GB) and the embedded-engine work. See `docs/packaging-plan.md`.

## 13. Generating documents must not block the provider
- Date asked: 2026-10-28 (follows from the M4 Air target)
- Status: noted
- Pressing **Generate** queues the work and returns at once; the provider moves to the next patient.
- The row shows progress, and each file icon appears as that document finishes.
- The queue survives changing the day and, ideally, restarting the app.
- Documents are generated one at a time, since two models at once would not fit in memory.
- Open: should the queue keep running when the app window is closed, and should it notify when a visit's documents are ready?

## 14. Order forms wired to their own questions
- Date asked: 2026-10-30
- Status: **built**
- Before: every form was asked the progress note's 24 questions. None of them named a field on the admit or discharge order, so those forms came out entirely blank after a minute of model time.
- Now: `DISCHARGE_ORDER_FIELDS` (19 questions) and `ADMIT_ORDER_FIELDS` (12) in `src/lib/formSpec.ts`, routed by `fieldsFor()` in `src/lib/visit.ts`.
- The forms themselves were regenerated so every fillable group carries an inline label; several had none and could not be addressed at all.
- Two filling bugs this surfaced and fixed: a heading with the same words as a field ("Discharge Medications") swallowed the real field below it, and options that wrap onto a second line could not be ticked.
- Guard added: a test asserts every question in a set names a real field on its own form, and every option exists on that field's line. That is the check that would have caught the original gap.
- As expected, an order form stays largely blank: on a synthetic discharge, 11 of 19 fields had nothing in the recording to fill them, and the "Needs your attention" list names them.

## 15. Record enabled out of the box
- Date asked: 2026-10-30
- Status: **built**
- The Record button was dead because the default transcription-model path did not match where the file actually was, and no note-writing model was chosen.
- Now: the app searches the known locations for a Whisper model on first run, and preselects the best installed note-writing model (Qwen2.5 14B first, as it scored best on the practice's test visits).
- The banner now names what is missing ("ffmpeg is missing", "a note-writing model is missing") instead of Record silently being disabled.

## 16. Patient names shown as initials on the schedule
- Date asked: 2026-10-30
- Status: **built**
- The board shows "A.T." rather than the full name, since it is often visible to other people in a clinic room.
- **Folder and file names keep the full name** ("Testcase, Alpha"), because the provider has to find the documents afterwards and initials would collide between patients.
- Open for the owner: the row still shows the age, sex and insurance line from the sheet ("40F / Insurer / KIOP PM 1"). Should that be hidden too?
