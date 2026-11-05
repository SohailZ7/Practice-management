# Desktop App: Architecture (draft)

> **Superseded (2026-11-04).** Ollama and the local note model are gone. **Current design (2026-11-04):** speech-to-text runs locally in the app via `whisper-rs`, with the model bundled in the DMG (no ffmpeg, no whisper-cli, no Homebrew, no first-run download). Audio is never saved (memory only). The transcript is saved as an encrypted Meetily-style per-visit folder (`transcripts.json` + `metadata.json`) and deleted after the server confirms the upload. Note writing runs in the cloud on Vertex AI (Gemini) under the Google BAA, not Ollama and not self-hosted. Google-only sign-in. One build with a Production/Staging/Localhost dropdown. Tokens in the macOS Keychain. Apple Silicon only. See `docs/final-architecture.md`. The text below is kept as history.

Companion to [requirements-v1](../specs/requirements-v1.md).

## Shape
```
Tauri 2 app (macOS, Apple silicon)
├─ UI: React + TypeScript (schedule board, review screen)
├─ Rust core
│   ├─ audio capture      (from Meetily: audio/)
│   ├─ transcription      (from Meetily: whisper_engine / parakeet_engine)
│   ├─ note drafting      (from Meetily: summary/ + templates; talks to local Ollama)
│   ├─ docx writer        (fills Templates/*.docx by heading style)
│   ├─ secure store       (SQLite/files encrypted, key in Keychain)
│   └─ api client         (HTTPS to the web app only)
└─ Local AI: Ollama (note model) + Whisper/Parakeet (transcription)

Web app (existing, Next.js + Postgres)
└─ New /api/desktop/* : token exchange, schedule, providers, consent
```

## Flow
1. Sign in (Google OAuth/PKCE) and fetch the day's schedule.
2. Board row: Consent on file -> Record; no consent -> Dictate note. Server re-checks consent at start (CON-4).
3. Stop -> encrypted temp audio -> local transcription -> audio deleted (default).
4. Appointment type picks the template section set. For follow-up/discharge, read the patient's latest note from their folder.
5. Fill sections one by one with the local model, using only transcript and earlier note; unknowns become "Not discussed in this recording".
6. Review screen (note + transcript, provenance on demand); confirm C-SSRS and medication consent.
7. Write `<root>/<Last, First>/<YYYY-MM-DD> <Type>.docx`.

## What we take from Meetily, and what we drop
Take: audio capture, whisper/parakeet engines, summary pipeline and JSON template idea, tray/permissions handling where useful.
Drop: analytics, cloud LLM providers, onboarding, meeting library, BlockNote editor, Windows/Linux GPU builds, license-upsell parts. Keep the MIT notice.

## Template handling
`Psychiatric_Master_Template_v2.docx` uses real Heading 1/2 styles (21 sections, 3 tables). A section map (heading text -> instruction, format, source: transcript / prior note / provider-only) is kept as JSON beside the template, so changing the Word file or the map does not need code changes. The filled AB packet is the reference for tone and for "to be verified" wording.

## Model sizing
Choose by memory: 64 GB -> ~30B, 24 GB -> ~14B, 18 GB -> ~8B. On 18 GB, unload the transcription model before loading the note model. Fill per section. Benchmark with synthetic transcripts before release.

## Risks
- Small local models can omit or invent details; mitigated by transcript-only rule, "not discussed" default, provenance view, mandatory review.
- Schedule rows have no patient record yet (web app change needed).
- Consent is a flag on a paper process; the app cannot verify the form.
- Patient names in folder names are PHI at rest; rely on FileVault and a non-synced folder.
- The web app is not deployed, so the desktop app first targets local dev.

## Build order
1. Web app: patient link + consent + desktop API (own spec version, own tests).
2. Desktop spike with synthetic data: mock board -> record 10 s -> transcribe -> fill template -> .docx.
3. Real schedule, sign-in, consent gating, review screen.
4. Model benchmarking on 18/24/64 GB; signing and updates.
