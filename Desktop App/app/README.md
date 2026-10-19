# Practice Notes (desktop spike)

Tauri 2 + React app: schedule board with Record / Dictate, local transcription (whisper.cpp), local note drafting (Ollama),
review screen, and a Word document saved in `<notes root>/<Last, First>/<date> <type>.docx`.

**Spike limits:** the schedule is a synthetic mock (`src/lib/mockSchedule.ts`), not the web app's Desktop API yet; sign-in,
idle lock and encrypted drafts are not built; sections the audio cannot fill stay as the blank template.

## Needs (macOS, Apple silicon)
`brew install rustup cmake ollama whisper-cpp ffmpeg`, `rustup default stable`, a Whisper model at
`~/Library/Application Support/PracticeNotesSpike/models/ggml-small.en.bin`, and `ollama pull qwen2.5:7b-instruct`.

## Commands
```bash
npm install
npm test                # note pipeline, template filler, folder naming (no engines needed)
npm run typecheck
npm run dev             # UI in a browser with FAKE engines
npx tauri dev           # the real app (needs PATH to include ~/.cargo/bin)
cd src-tauri && cargo test --lib                      # native unit tests
SPIKE_AUDIO=visit.aiff cargo test --lib -- --ignored  # real Whisper + Ollama on synthetic audio
SPIKE_AUDIO=visit.aiff npx vitest run tests/real.integration.test.ts   # full pipeline on real engines
```
Environment overrides: `PRACTICE_NOTES_ROOT`, `PRACTICE_TEMPLATES_DIR`, `WHISPER_MODEL`, `OLLAMA_URL`.
