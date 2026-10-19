# Desktop App: Requirements v2

Status: Draft (current version)
Date: 2026-10-19
Owner: Sohail
Related: web app specs in `SaaS app/specs/` (latest: requirements-v18.md). Behavior shared with the web app (Schedule, access levels, practice time zone) follows those specs.

Every new set of requirements creates a new `requirements-vN.md` here as a full current copy with a "Changes since" section. Older versions are kept.

## Changes since v1
From the spike's model tests (see `docs/model-comparison.md`):
- **Minimum configuration** (SYS-1 to SYS-4): a 14B-class local model with both safety passes, on an Apple silicon Mac with 24 GB memory or more. 18 GB is no longer a supported minimum. NOT-8 is updated to match.
- **Suicide-risk questions** (NOT-10): each risk line is answered as its own yes / no / not-asked question with a quote from the transcript.
- **Verification pass** (NOT-11, DOC-8): every drafted sentence is checked against the transcript; unsupported or wrong-person sentences are removed from the note but shown to the provider, who can restore them.
- **Collateral and attribution** (NOT-12): a report from someone other than the patient is labeled as such; a doctor's proposal is not written as the patient's request.

## Changes in v1 (since v0)
First version.

## Purpose
A Mac desktop app for providers. It shows the day's schedule, records a visit after the patient's consent is on file, turns the conversation into a draft psychiatric note using the practice's Word template, lets the provider review and correct it, and saves a Word document in a folder for that patient. Transcription and note-writing run on the Mac; no audio or text is sent to any AI service.

## Decisions already made
- New Tauri app that reuses selected parts of Meetily (MIT license): audio capture, local transcription, template and summary engine. Meetily's analytics, cloud AI providers and meeting library are not used. Meetily's copyright notice is kept; Parakeet attribution (CC-BY-4.0) is shown in About if that model is used.
- Fully local AI: local transcription (Whisper or Parakeet) and a local language model (via Ollama, permissively licensed, e.g. Qwen) fill the template.
- The schedule comes live from the web app (needs a new API there, see "Web app changes").
- Mac only for now. Minimum supported: Apple silicon Mac with 24 GB memory (see SYS-1 to SYS-4).
- Per-patient consent is recorded once ("consent on file"); without it the app does not record (option A).
- The provider reviews and approves every note before it is saved.

## Requirements

### Sign-in and access (ACC)
| ID | Requirement | Priority |
|---|---|---|
| ACC-1 | Sign in with Google in the system browser (OAuth with PKCE). Only emails on the web app's allowlist can use the app. | Must |
| ACC-2 | The login token is kept in the macOS Keychain, never in plain files. | Must |
| ACC-3 | The app uses the same module levels as the web app. A user needs Schedule access to see the board and Edit access (or provider role) to record and write notes. Rules are enforced on the web app's server, not only in the desktop UI. | Must |
| ACC-4 | The app locks after a period of inactivity (default 10 minutes, set by the Admin) and asks the user to unlock with their Mac password or Touch ID. | Must |
| ACC-5 | Signing out removes the cached schedule and any unsaved drafts from the device. | Must |

### Schedule board (SCH)
| ID | Requirement | Priority |
|---|---|---|
| SCH-1 | The home screen shows one day's schedule (default: today in America/Los_Angeles, never the device's time zone). The user can move to another day. | Must |
| SCH-2 | Each row shows the patient name (Last, First), the program (track), the appointment type, the time, and the provider. A provider sees their own patients by default and can switch to another provider if their access allows. | Must |
| SCH-3 | Each row has a Record button, plus a consent status badge (SCH-4). Rows marked absent, canceled or missed have no Record button. | Must |
| SCH-4 | The badge reads "Consent on file" (green) or "No consent" (gray). | Must |
| SCH-5 | Dates are `YYYY-MM-DD` strings throughout. | Must |
| SCH-6 | The board is read-only in v1. Schedule edits are still made in the web app. | Must |
| SCH-7 | If the web app cannot be reached, the board shows the last loaded day with a clear "offline" banner; recording and notes still work for patients already loaded. Offline sync of anything back to the web app is out of scope for v1. | Should |

### Consent (CON)
| ID | Requirement | Priority |
|---|---|---|
| CON-1 | The web app stores one consent record per patient: patient, date consent was given, who confirmed it, optional note (for example "signed intake form"), and whether it is currently active. | Must |
| CON-2 | A user with Edit access can set or withdraw consent from the board. Setting it asks them to confirm "Patient signed AI documentation consent on [date]". Withdrawal turns Record off immediately. | Must |
| CON-3 | Setting and withdrawing consent is written to the audit log (who, when, patient). | Must |
| CON-4 | The Record button is enabled only when consent is active. The check is made on the web app's server when recording starts; a locally edited app cannot bypass it. | Must |
| CON-5 | Without consent, the row offers **Dictate note** instead: the provider speaks a short summary after the visit and the app writes the draft from it (same steps as NOT-1 to NOT-9). No patient audio is captured. | Must |
| CON-6 | Notes made from a recording say "Recorded with patient consent on file" in the footer. | Should |
| CON-7 | The app does not verify the signed form; the consent text is the practice's paperwork, approved by its counsel. | Info |

### Recording and transcription (REC)
| ID | Requirement | Priority |
|---|---|---|
| REC-1 | Record starts capturing the Mac microphone (and system audio if the provider uses a video visit). A clear on-screen indicator shows recording is active, with Pause and Stop. | Must |
| REC-2 | Audio is written to an encrypted temporary file, transcribed on the device, then securely deleted. The default is to keep **only the transcript**. An Admin setting can keep audio, off by default. | Must |
| REC-3 | Transcription runs locally. The app works with no internet connection once models are installed. | Must |
| REC-4 | The transcript is stored encrypted, attached to the visit, and visible in the review screen alongside the draft. How long transcripts are kept is set by the Admin (default: until the note is saved, then deleted). | Must |
| REC-5 | If the app quits or crashes mid-recording, the audio captured so far is recovered on next launch (still encrypted), or the provider is told it was lost. | Should |

### Note drafting (NOT)
| ID | Requirement | Priority |
|---|---|---|
| NOT-1 | The appointment type chooses what to write: **Psych Eval** fills sections 1 to 18 and 21 of the Master template; **Follow-up** and **Follow-up & Admit Order** fill the Progress Note Carry-Forward block; **DC Orders Only** fills the Discharge Summary block. | Must |
| NOT-2 | The draft uses the practice's Word templates in `Templates/` (Psychiatric_Master_Template_v2.docx). Section headings are found by their Word heading styles, and the template's layout, fonts and tables are kept. | Must |
| NOT-3 | The note is written in the third person: "the patient reports...". | Must |
| NOT-4 | For follow-ups and discharges, the app reads the patient's most recent earlier note from their folder and carries relevant history forward. | Must |
| NOT-5 | The model may only use what is in the transcript or the earlier note. Anything not found is written as "Not discussed in this recording" and is never guessed. Medications, doses, diagnoses and risk statements must appear in the transcript. | Must |
| NOT-6 | Parts that cannot come from audio (appearance and behavior in the mental status exam, exam findings, billing, attestation) are marked "Not assessed in this recording" and left for the provider. | Must |
| NOT-7 | Sections are filled one at a time so smaller models stay accurate. | Should |
| NOT-8 | The language model is a 14B-class instruct model by default. A larger model is allowed on Macs with 32 GB or more; a smaller model (7B) is not offered by default because it could not reliably check its own work in tests. Transcription finishes and its model is unloaded before the note model loads. | Should |
| NOT-10 | The suicide-risk section is filled by six separate questions (wish to be dead, thoughts, method / intent / plan, behavior, protective factors, safety plan). Each answer is YES, NO or NOT_ASKED with a one-sentence statement and the supporting words from the transcript. A denial is recorded as a denial. Protective factors and safety plan can only be YES or "not discussed". A statement that only describes an absence ("does not report ...") is "not discussed". A relative's or another person's suicidal thoughts or acts are never the patient's. | Must |
| NOT-11 | After each section is drafted, a verification pass checks every sentence against the transcript (and the earlier note): whether it is supported, who it concerns, and who said it. Unsupported sentences, and sentences about someone other than the patient in a patient-history section, are removed from the note. A supporting quote that cannot be found only flags the line. Spelled-out numbers count as the same as digits. | Must |
| NOT-12 | A report made by someone other than the patient (spouse, parent) is written as "Another person present reports ...". A proposal made by the doctor is not written as the patient's request; if the verifier sees that mismatch the line is flagged for review. | Must |
| NOT-9 | Each filled statement can be traced back to the transcript passage it came from, shown on demand in the review screen. | Should |

### Review and save (DOC)
| ID | Requirement | Priority |
|---|---|---|
| DOC-1 | After drafting, the review screen shows the note beside the transcript. The provider can edit any section. | Must |
| DOC-2 | Before saving, the provider must confirm the **suicide risk (C-SSRS)** section and the **medication informed consent** section. Saving is blocked until both are confirmed or marked not applicable. | Must |
| DOC-3 | Save writes a `.docx` to `<root>/<Last, First>/<YYYY-MM-DD> <Appointment type>.docx`. The patient folder is created if missing. | Must |
| DOC-4 | If a file with that name exists, the app asks before replacing it, or adds " (2)". | Must |
| DOC-5 | The root folder is chosen at first run (default: Documents/Patient Notes). The app warns if the folder is inside a cloud-synced location (iCloud Drive, Dropbox, OneDrive) and recommends FileVault. | Must |
| DOC-6 | Drafts not yet saved are kept encrypted on the device until the provider saves or discards them. | Should |
| DOC-8 | A sentence removed by the verification pass appears in the review screen with the reason, and a **Restore** button puts it back as a flagged line. Removed text is never silently lost. | Must |
| DOC-7 | The patient's saved visit shows on the board as "Note saved" and links to the file. | Should |

### System requirements (SYS)
| ID | Requirement | Priority |
|---|---|---|
| SYS-1 | Apple silicon Mac (M2 or newer), **24 GB** unified memory or more, macOS 14 or later, 30 GB free disk. | Must |
| SYS-2 | A 14B-class instruct model runs with a 16k context in about 10 GB (measured). The transcription model (about 1 GB) is unloaded before it loads. | Must |
| SYS-3 | The app checks memory at first run and refuses to start recording on a Mac below SYS-1, explaining why. An Admin may override for a test device. | Should |
| SYS-4 | Expected drafting time on a Pro-class chip is under 2 minutes per note; on a base chip it may be 2 to 3 times longer. The app shows progress by section and never blocks the schedule while drafting. | Should |

### Security and privacy (SEC)
| ID | Requirement | Priority |
|---|---|---|
| SEC-1 | No patient name, MRN, transcript text or note text appears in logs, crash reports, window titles, URLs, analytics or temporary files. There is no analytics or telemetry in the app. | Must |
| SEC-2 | Anything the app stores on the device (drafts, transcripts, cached schedule) is encrypted with a key held in the Keychain. | Must |
| SEC-3 | The app only talks to the practice's web app (HTTPS) and to download AI models from a fixed list the Admin approves. It sends no patient content to any other server. | Must |
| SEC-4 | The Notes folder is not protected by the app. The practice is responsible for disk encryption (FileVault) and device security; the app shows a warning if FileVault is off. | Must |
| SEC-5 | Tests and examples use synthetic patients and synthetic audio only. | Must |
| SEC-6 | Software alone does not make the practice HIPAA compliant; the practice's policies, risk analysis and agreements still apply. | Info |

### Updates and install (OPS)
| ID | Requirement | Priority |
|---|---|---|
| OPS-1 | Mac app (Apple silicon, macOS 14+), distributed as a signed installer. Signing needs an Apple Developer account. | Must |
| OPS-2 | The app checks for updates from a location the practice controls and installs them with the user's approval. | Should |
| OPS-3 | First run walks the user through microphone permission, choosing the notes folder, and downloading the approved models. | Must |

## Web app changes this needs (specified in [`SaaS app/specs/requirements-v19.md`](../../SaaS%20app/specs/requirements-v19.md), section 5.7)
1. **Authenticated desktop API** (the web app has none today; it only has server actions): sign-in token exchange, schedule for a date, provider list, patient consent get/set. Permissions are the same module levels as the web UI.
2. **Patient link on schedule entries.** Schedule rows hold free-text `clientInfo`, not a patient. The board needs a real patient record (the existing `BillingPatient` has last name, first name, optional MRN). Open: link schedule entries to `BillingPatient`, or add a new patient table.
3. **Program on the board.** Use the schedule's track name (for example "Track 1 IOP") as the program unless you say otherwise.
4. **Consent table** and audit log entries (CON-1 to CON-3).
5. Web app deployment (Cloud Run) is still pending; until then the desktop app points at the local dev server.

## Open items for the owner
- Link method for patient records (item 2 above).
- Patient folder names are "Last, First", which puts patient names in file paths and backups. Acceptable? An MRN-based name would avoid that. (Decided: Last, First.)
- The 14B result (95% of safety checks on 12 synthetic visits) comes from one Mac and one model family. It must be repeated on a real 24 GB Mac, with other model families, and with a clinician checking the ground truth, before relying on it.
- 18 GB Macs: not supported in v2 (open: allow a 7B fallback with extra review, or require 24 GB).
- Exact consent wording is for the practice's counsel; Washington requires every party's consent to a private recording.
- Transcript retention period and whether transcripts count as part of the medical record.
- Windows support: later.
