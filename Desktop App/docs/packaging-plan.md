# Making the app a single installable

Goal: a provider double-clicks one file, the app installs, and it works. No Homebrew, no terminal, no Ollama to start.

## What is external today (the problem)
The spike shells out to tools that happen to be on this Mac:

| What | Today | Size |
|---|---|---|
| Audio conversion | `/opt/homebrew/bin/ffmpeg` | ~80 MB |
| Transcription | `/opt/homebrew/bin/whisper-cli` | ~5 MB |
| Transcription model | `ggml-small.en.bin` in Application Support | 470 MB |
| Note writing | Ollama service on `127.0.0.1:11434` | app + service |
| Language model | `qwen2.5:14b-instruct` in Ollama's store | 9 GB |
| Templates | the repo's `Templates/` folder | 150 KB |

On another Mac, none of that exists. So "standalone" means absorbing the first four and deciding what to do about the 9.5 GB of model weights.

## The shape of the answer
**Put the engines inside the app. Keep the model weights outside the installer and fetch them on first run.**

A 10 GB installer is a bad idea: slow to download, awkward to sign and notarize, and it has to be rebuilt whenever a model changes. Every local-AI app of this kind ships a small installer and downloads weights afterwards.

Expected result: an **80 to 120 MB `.dmg`**, then a one-time ~9.5 GB model download on first launch, with a progress bar.

## How each piece gets absorbed
1. **Drop ffmpeg entirely.** Record audio in Rust with `cpal` straight to 16 kHz mono WAV (`hound`), which is exactly what Whisper wants. That removes an 80 MB dependency *and* the trickiest licensing question, since ffmpeg's LGPL/GPL terms would otherwise have to be met in the bundle. It also replaces the browser's MediaRecorder, so audio never passes through the webview.
2. **Link Whisper in, don't shell out.** The `whisper-rs` crate (0.16) compiles whisper.cpp into the app binary with Metal acceleration on Apple silicon. No sidecar process, no PATH lookups. This is what Meetily does.
3. **Replace Ollama with embedded llama.cpp.** The `llama-cpp-2` crate loads a GGUF model file in-process. The app then has no background service, no port, and no second thing for the user to install or keep running. The model becomes a file the app owns rather than an entry in Ollama's store.
4. **Bundle the templates** as Tauri resources, so `Templates/forms/*.docx` and the master template ship inside the app.
5. **Models download on first run.** A setup screen fetches the Whisper model (470 MB) and the language model (~9 GB for a 14B at 4-bit), verifies a checksum, and stores them in Application Support. It resumes if interrupted, and the app refuses to record until both are present.

## Where the models come from (one real decision)
| Option | Cost and effort | Notes |
|---|---|---|
| **Practice's own GCS bucket (recommended)** | Pennies per install in egress; one upload | You control the exact version, and a model cannot vanish or change under you. Also lets you ship a fine-tuned model later without touching the app. |
| Hugging Face directly | Free | Depends on their availability, and a repo can move or be renamed. |
| Offline copy on a USB stick or file share | No bandwidth | Needed anyway for a Mac with poor internet; the setup screen should accept "I already have the files". |

Licensing is fine for redistribution either way: Qwen2.5 14B is Apache 2.0, and the Whisper ggml models are MIT. Keep the notices in an About screen.

## Signing and notarization (required, or it looks broken)
Without this, macOS tells each provider the app is damaged or from an unidentified developer.
1. Join the Apple Developer Program, **$99 a year**.
2. Create a "Developer ID Application" certificate.
3. Tauri signs the bundle, then submits it to Apple for notarization and staples the result.
4. The `.dmg` then opens normally on any Mac.

This is configuration plus an Apple account, not much code, but it cannot be skipped for a real rollout.

## Updates
The `tauri-plugin-updater` crate (2.14) checks a URL the practice controls, for example a JSON file in the same GCS bucket, and installs a signed update with the user's approval. Model downloads stay separate, so an app update is a few megabytes.

## Work involved
| Step | Size |
|---|---|
| Record to WAV in Rust with cpal, drop ffmpeg and MediaRecorder | moderate |
| Link whisper-rs, drop the whisper-cli shell-out | moderate |
| Embed llama-cpp-2, drop Ollama | moderate to large (prompt behavior must be re-checked against the 12-case test set, since sampling defaults differ) |
| First-run model downloader with resume and checksums | moderate |
| Bundle templates as resources | small |
| Signing, notarization, DMG | small, needs the Apple account |
| Updater | small |

## Revised: two phases

**Phase 1 ships the model locally, on Macs with as little as 18 GB. Phase 2 moves it to GCP.** That reverses the shortcut
suggested below: embedding llama.cpp is back on the critical path, because phase 1 has no server to call.

| | Phase 1 (local) | Phase 2 (hosted) |
|---|---|---|
| Installer | 80 to 120 MB | 80 to 120 MB |
| First-run download | ~8 to 9 GB (model) + 470 MB (Whisper) | 470 MB (Whisper only) |
| Minimum Mac | 18 GB, to be proven on real hardware | any Apple silicon Mac |
| Embedded llama.cpp | **required** | not required |
| Model choice | limited to what fits ~10 to 12 GB | anything that fits the server |

Build the model backend as a switch from the start, so phase 2 is a configuration change rather than a rewrite.

## Background: why hosting was considered first

That settles the fork, and it changes what is worth building now.

**What hosting removes from the installer.** The 9 GB language model is the only reason this is hard. Without it:

| | Model local | Model hosted on GCP |
|---|---|---|
| Installer | 80 to 120 MB | 80 to 120 MB |
| First-run download | ~9.5 GB | 470 MB (Whisper only) |
| Minimum Mac | 24 GB memory | any Apple silicon Mac |
| Time per note | 35 to 50 s on an M5 Pro, 2 to 3 min on a base chip | the same for everyone, set by the server |
| Embedded llama.cpp | required | not required |

So the hosted route makes the standalone installer **easier**, not harder, and drops the hardware requirement that was the whole point of the 24 GB test plan.

**What this means for the order of work.**
1. **Build the model backend as a switch now.** One interface, two implementations: local or a hosted endpoint. This is small, and it keeps both doors open. The app already treats the model as a swappable part.
2. **Keep Ollama for local use during development.** It is fine on the owner's own Mac and needs no packaging work.
3. **Do not embed llama.cpp yet.** It is the largest item on the list, and hosting makes it unnecessary. Build it only if the app must write notes with no internet (see the question below).
4. **Package once the hosted endpoint exists.** The installer then carries the app, Whisper and the templates, and the first-run download is 470 MB.

Transcription stays on the Mac either way, so audio never leaves the device and only text goes to the server.

## The question this raises
**Must the app write notes when the internet is down?**

- **No:** the plan above is the whole plan. No embedded llama.cpp, no 9 GB download, no 24 GB requirement. Note writing simply needs the network, as the schedule already does.
- **Yes:** keep the local path as a fallback, which means embedding llama.cpp after all and keeping the 24 GB minimum for any Mac expected to work offline.

A middle answer that may be the real one: the app can always **record and transcribe offline**, holds the transcript, and writes the note when the network returns. That covers a dropped connection during a visit without needing a 9 GB model on every Mac.

## What to decide
1. Must notes be written with no internet, or is record-and-transcribe-offline enough? (This decides whether embedded llama.cpp is ever built.)
2. Whether to buy the Apple Developer account now, since nothing can be distributed without it.
3. Hosting the model on GCP depends on the BAA covering GPU services, which is still unconfirmed with Google.
