# Settled architecture (2026-11-01)

Two pieces: a **web app** where all the work happens, and a **small native recorder** that exists only to do what a
browser cannot. The native app pulls from the cloud and pushes to the cloud; it holds nothing of its own.

## Why the native recorder has to exist
macOS does not let a web page capture the audio coming out of the speakers. For a telehealth visit, a browser would
record the provider and not the patient. Meetily manages it because it is native: its source uses **ScreenCaptureKit**
and **Core Audio process taps** (`AudioHardwareCreateProcessTap`, with `NSAudioCaptureUsageDescription` in its
Info.plist). Those are native-only APIs.

Because the recorder is native, **BlackHole is no longer needed**: no virtual audio devices, no Multi-Output setup, no
routing that can silently break. That was the strongest argument against the browser-only route and it disappears.

## What each piece does

### The native recorder (small, self-contained)
- Signs in, pulls the day's schedule from the web app.
- Records the visit: the microphone **and** the system audio, as two channels.
- Transcribes on the Mac.
- Pushes the transcript to the web app and shows what happened.
- Nothing else. No documents, no templates, no editing, no model.

Everything it needs is inside it. **Nothing is installed alongside it**: no Homebrew, no Ollama, no ffmpeg, no
whisper-cli, no BlackHole. The transcription model is bundled in the DMG, so there is no first-run download.

Privacy and sign-in: audio is never saved (memory only). The transcript is saved as an encrypted Meetily-style
per-visit folder (`transcripts.json` + `metadata.json`) and deleted after the server confirms the upload. Sign-in is
Google-only, tokens live in the macOS Keychain, and one build has a Production/Staging/Localhost dropdown.

| | |
|---|---|
| Installer | DMG with the transcription model bundled (about 500 MB), signed and notarised |
| First run | nothing to download; the model is in the DMG |
| Needs | Apple Silicon Mac, macOS 13 or later, for ScreenCaptureKit |
| Permissions asked | microphone, and screen recording (which is what macOS calls system audio capture) |

### The web app (everything else)
The schedule, the paste flow, the documents as Markdown, the pop-up editor with its save prompt, PDF download, and the
note writing in the cloud on Vertex AI (Gemini) under the Google BAA.

## What gets built into the recorder, rather than installed
| Today (spike) | In the shipped recorder |
|---|---|
| `ffmpeg` shelled out to, from Homebrew | gone: capture 16 kHz audio in Rust (`cpal`) into memory only, never saved to disk |
| `whisper-cli` shelled out to, from Homebrew | `whisper-rs` compiled in, with Metal acceleration; model bundled in the DMG |
| Ollama running separately | gone: notes are written in the cloud on Vertex AI (Gemini), under the Google BAA |
| Microphone only, through the browser | microphone **and** system audio, natively |

Note writing stays in the cloud (Vertex AI, Gemini, under the Google BAA); there is no local or self-hosted
note model.

## Two channels, and why that matters more than it sounds
The recorder keeps the provider's microphone and the system audio on **separate channels**. Transcribe them separately
and who said what is known rather than guessed.

That retires the hardest problem in this system. Every model tested got speaker attribution wrong somewhere: a
spouse's report written as the patient's, a relative's suicide attempt filed under the patient's own history. The
verification pass exists to catch exactly that. For telehealth visits this makes the problem go away instead of being
checked for. It does not help in-person visits, where both voices arrive through one microphone.

## The work this implies
| Piece | Size |
|---|---|
| System audio capture (ScreenCaptureKit) | **the main new piece**; Meetily is MIT-licensed and is a working reference |
| Capture audio in memory with `cpal`, drop ffmpeg | moderate |
| Compile in `whisper-rs`, drop the shell-out | moderate |
| Pull the schedule and push the transcript | small |
| Bundle the model in the DMG, encrypted per-visit transcript folder, delete after confirmed upload | moderate |
| Signing and notarisation | small, but needs the Apple Developer account ($99/year) |

Most of the current desktop app is **removed** rather than rewritten: the document generation, templates, form filling
and safety passes all move to the web app, where they run unchanged.
