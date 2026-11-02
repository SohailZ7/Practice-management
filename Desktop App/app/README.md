# Practice Recorder

A small Mac app that does the two things a browser cannot: capture the audio of a visit (including, in time, the
system audio of a Zoom or Meet call) and transcribe it on this machine.

Everything else — the schedule, the notes, the documents, editing and PDFs — lives in the practice web app. This app
pulls the day's visits, records, transcribes here, and pushes back the text.

**The recording never leaves this Mac.** It is turned into text locally and only the text is sent.

## Needs (macOS, Apple silicon)
```bash
brew install whisper-cpp ffmpeg
```
plus a Whisper model at `~/Library/Application Support/PracticeNotes/models/ggml-small.en.bin` (the app looks in a few
known places). A shipped build will compile these in and download the model itself; today they are still external.

## Commands
```bash
npm install
npm test                # the practice API client
npm run typecheck
npm run dev             # the screens in a browser, with fake engines
npm run tauri dev       # the real app (PATH must include ~/.cargo/bin)
cd src-tauri && cargo test --lib
```

## Setup inside the app
The practice app's address, a sign-in token from it, and the transcription model file.

## Still to build
- **System audio capture** (ScreenCaptureKit), so a telehealth visit records the patient as well as the provider.
  Until then this records the microphone only, which is enough for an in-person visit.
- Compiling whisper.cpp in and downloading the model on first run, so nothing is installed alongside the app.
- Signing and notarisation, which need an Apple Developer account.
