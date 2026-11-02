# Bringing the note writing into the web app

The owner's decision (2026-11-01): go fully cloud. The documents do not need to be on a local disk, the desktop app
stays as its own separate thing, and the note-writing flow moves into this web app.

## What the owner asked for
1. The note-writing flow becomes part of this app.
2. Documents are stored as **Markdown**, not Word files.
3. Clicking a document's icon opens a **pop-up showing it**; the provider edits it there.
4. Closing the pop-up asks whether to save any changes; saving writes to the cloud.
5. A **PDF copy** can be downloaded.
6. **Both** ways of getting a day's schedule: the existing Schedule module, and the paste flow from the desktop app.
7. Patient names show as **initials** for now.
8. The desktop app is kept, not deleted.

## The BAA is not blocked on a domain
The owner believed a domain is needed before a BAA can be signed. It is not. Google Cloud's BAA is accepted per
**project**, free, in four clicks on the IAM privacy page (see the steps in `Desktop App/docs/` discussion and
support.google.com/cloud/answer/6329727). A domain is only needed for a custom web address, and the **Workspace**
BAA is the one tied to a domain; the Cloud one is not.

This matters because it removes the reason to build "BAA-ready but not BAA-covered". Accept it on
`practice-mgmt-sz` now, and the only remaining question is whether it covers Cloud Run **with a GPU**, which still
needs confirming with Google in writing.

Until it is accepted, development uses invented patients only. That is true regardless of architecture.

## What moves, and what has to be rebuilt
About 1,630 lines of logic in `Desktop App/app/src/lib/` are plain TypeScript with no desktop dependency, and move
across almost unchanged: schedule parsing, the document map per appointment type, the drafting pipeline, both safety
passes, the form questions, and the grounding checks. Only `engine.ts` is desktop-specific.

What is genuinely new:

| Piece | Note |
|---|---|
| Recording in the browser | MediaRecorder; the audio is uploaded rather than kept |
| Transcription on the server | Whisper has to run somewhere: a second Cloud Run service, or a transcription API (which needs its own BAA) |
| The model on the server | Cloud Run with an L4, scale to zero, warmed when Record is pressed |
| Document storage | Markdown in Cloud Storage or Postgres, with a version each time it is saved |
| The editor pop-up | Markdown editing, with a save prompt on close |
| PDF rendering | Markdown to PDF for download |
| Paste flow | ported from the desktop app, as a second way to load a day |

## The one thing that changes shape: the forms
The Psychiatrist Progress Note and the two orders are **checkbox forms**. As Markdown they become structured lists
with `- [ ]` boxes. That edits well in a pop-up, but a Markdown-to-PDF rendering **will not look like Fairfax form
4071**. The Word recreation at least echoed the paper layout.

So there is a choice to make, and it is the owner's:
- **Markdown everywhere.** Simplest, edits well, but what prints is the practice's own layout, not the hospital's form.
- **Markdown for the narrative notes, Word for the forms.** The forms keep their layout and download as .docx or PDF,
  but they are not editable in the pop-up in the same way.
- **Markdown as the source, rendered back into the Word form on download.** Best of both and the most work.

Related: the Word forms are already a reconstruction, not the official Fairfax files, so neither route produces the
official form. Asking Fairfax for blank fillable originals would settle this properly.

## Suggested order of work
1. Port the library code into the web app and run its tests there (no behaviour change, nothing user-visible).
2. Schedule: add the paste flow beside the existing module, and show initials.
3. Documents: storage, the pop-up editor with the save prompt, and PDF download. Use a typed-in transcript at first,
   so the whole document flow can be finished before any audio or model work.
4. The model on Cloud Run, called from the server, warmed when Record is pressed.
5. Recording in the browser and transcription on the server.
6. Accept the BAA, confirm GPU coverage, and only then let real patient data near it.

Steps 1 to 3 need no cloud GPU and no BAA, because they can be built and tested entirely with invented patients.
