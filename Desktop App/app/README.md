# Practice Recorder

A small Mac app that does the two things a browser cannot: capture the audio of a visit (including the system audio
of a Zoom or Meet call) and transcribe it on this machine.

Everything else (the schedule, the notes, the documents, editing and PDFs) lives in the practice web app. This app
pulls the day's visits, records, transcribes here, and pushes back the text. A cloud model on the practice app
(Vertex) writes the note from that text.

**No audio is ever saved.** It is captured and transcribed in memory; only the text is kept and sent.

## How it works
- **One build, three environments.** Setup has an Environment dropdown: Production (default), Staging, Localhost.
  The addresses are built in (no free-text URL). A coloured banner shows on every screen when not on Production.
  Each environment has its own sign-in; the dropdown is locked while a recording runs.
- **Google sign-in only.** Sign-in opens the system browser (PKCE) and the practice app issues tokens. If the server
  has no Google sign-in set up, the app says so. Tokens (access and refresh) live in the macOS Keychain, never in
  settings.json; plaintext tokens from older versions are moved to the Keychain and scrubbed. On a 401 the app
  renews the sign-in once (`/api/desktop/v1/auth/refresh`) and retries; if that fails the sign-in screen appears.
- **Local Whisper, in process.** whisper.cpp is built into the app (whisper-rs, Metal on Apple silicon). The
  microphone and the system audio are transcribed separately, in chunks, so every segment is tagged `mic` or
  `system`. There is no ffmpeg, no whisper-cli and no Ollama.
- **Transcript queue.** After transcription the text is saved to
  `~/Library/Application Support/PracticeNotes/queue/<visit id>/` (`transcripts.json`, `metadata.json`), encrypted
  with AES-256-GCM using a random key kept in the Keychain. It is uploaded to the environment recorded in its
  metadata, and the folder is shredded only after the server answers 200. If the upload fails the folder stays,
  the row says "Saved on this Mac, will retry", and the app retries at launch, when a sign-in becomes available,
  and from the Retry all button.
- Only https is accepted, except http to localhost / 127.0.0.1.

## Whisper model
The model (`ggml-small.en.bin`, 487 MB) is bundled as a Tauri resource and is **not** in git.
```bash
scripts/place-model.sh            # copies it from ~/Library/Application Support/PracticeNotesSpike/models/
```
This puts it in `src-tauri/resources/models/` (git-ignored) so `tauri build` bundles it. In development the app also
looks in `~/Library/Application Support/PracticeNotes/models/` and `.../PracticeNotesSpike/models/`.

## Commands
```bash
npm install
npm test                # the practice API client, environments, token refresh, queue upload
npm run typecheck
npm run dev             # the screens in a browser, with fake engines
npm run tauri dev       # the real app (PATH must include ~/.cargo/bin)
cd src-tauri && cargo test --lib
```
Building needs cmake (`brew install cmake`) for whisper.cpp; the Command Line Tools are enough, full Xcode is not.

## Before it can be used on a server
Each server needs a Google OAuth client of type **Desktop app**, with `GOOGLE_DESKTOP_CLIENT_ID` and
`GOOGLE_DESKTOP_CLIENT_SECRET` set on the practice app (the secret stays on the server). Until then the app shows "Google sign-in is not set up on
this server yet" for that environment.

## Still to build
- Signing and notarisation (needs an Apple Developer account).
