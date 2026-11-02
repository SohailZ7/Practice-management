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
BlackHole. The one exception is the transcription model, which is too large to sit in an installer; the app downloads
it itself on first run with a progress bar, so the provider never runs a second installer.

| | |
|---|---|
| Installer | roughly 30 to 50 MB, signed and notarised |
| First run | downloads the transcription model, about 470 MB |
| Needs | macOS 13 or later, for ScreenCaptureKit |
| Permissions asked | microphone, and screen recording (which is what macOS calls system audio capture) |

### The web app (everything else)
The schedule, the paste flow, the documents as Markdown, the pop-up editor with its save prompt, PDF download, and the
note-writing model on Cloud Run.

## What gets built into the recorder, rather than installed
| Today (spike) | In the shipped recorder |
|---|---|
| `ffmpeg` shelled out to, from Homebrew | gone: record straight to 16 kHz WAV in Rust (`cpal`) |
| `whisper-cli` shelled out to, from Homebrew | `whisper-rs` compiled in, with Metal acceleration |
| Ollama running separately | gone: the note-writing model is on Cloud Run |
| Microphone only, through the browser | microphone **and** system audio, natively |

**If a local note-writing model is ever wanted**, the same rule applies: `llama-cpp-2` compiled in, with the model
downloaded on first run. Not Ollama, not a second thing to install. That is not needed while the model is hosted, and
it is the single largest piece of work being avoided by hosting it.

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
| Record to WAV with `cpal`, drop ffmpeg | moderate |
| Compile in `whisper-rs`, drop the shell-out | moderate |
| Pull the schedule and push the transcript | small |
| First-run model download, with resume | moderate |
| Signing and notarisation | small, but needs the Apple Developer account ($99/year) |

Most of the current desktop app is **removed** rather than rewritten: the document generation, templates, form filling
and safety passes all move to the web app, where they run unchanged.
