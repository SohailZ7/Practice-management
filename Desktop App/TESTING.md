# Testing the Practice Recorder on your Mac (staging, fake data only)

> The released app is Production only. To test against staging, build and open the separate **Practice Recorder (Staging TEST)** app (`app/scripts/build-staging-test.sh`, installs to `~/PracticeRecorder-StagingTEST`). In it, Setup shows the Staging/Localhost choice and a red banner; the steps below that say "Set Environment to Staging" apply to that app only. Never install it on a staff Mac.

Use **Staging** and **made-up data only**. Never read real patient details aloud.

## 1. Open the app (it is unsigned)
1. Open the folder `Desktop App/app/src-tauri/target/release/bundle/macos/` (path also in the report you got).
2. Drag **Practice Recorder.app** to your Desktop.
3. Right-click it, choose **Open**, then click **Open** in the warning box. (Only the first time.)
   - If macOS still refuses, run once in Terminal: `xattr -dr com.apple.quarantine ~/Desktop/"Practice Recorder.app"` and open it again.

## 2. Pick Staging and sign in
1. Click **Setup**. Set **Environment** to **Staging** (a STAGING banner appears).
2. Click **Sign in with Google**. Your browser opens; choose your account and approve.
3. Back in the app, Setup should show you as signed in.
   - If you see "forbidden"/not allowed: your email is not on the staging allowlist. Check in the staging web app under the admin Users page (your email must be listed and active). Ask the main chat to add it.

## 3. Allow Microphone and System Audio Recording
1. When macOS asks for **Microphone**, click Allow.
2. For a video or phone visit (the **Patient is on a call** checkbox on Visits) it also needs **System Audio Recording** (for the other person's voice from the speakers), not Screen Recording. Start a recording with the checkbox ticked; macOS asks once, click Allow. If it does not ask, or the other side comes out empty: System Settings > Privacy & Security > scroll to **System Audio Recording** (the section below Screen Recording), switch on Practice Recorder, quit and reopen the app. Needs macOS 14.2 or later. Until it is allowed the app records silence for that side and warns you that only one side was heard.
3. If you missed a prompt: System Settings > Privacy & Security > Microphone, switch it on.

## 4. Load a fake schedule row
1. Go to **Visits**, click **Paste schedule**. Set Provider to `Dr. Example Provider`.
2. Paste this (tabs between columns; copy from a spreadsheet, or ask for a ready-made copy):
   - Header: `Tracks, Type, Client Info, Absent, Canceled, Provider, Complete, Column1, Column2`
   - Row: `KIOP-AM 9:00 - 11:30, Follow-up, Alpha Testcase/40F/Insurer, FALSE, FALSE, Dr. Example Provider, FALSE, FALSE, Select Option`
3. Click the add button. You should see "Added 1 visit".

## 5. Record 30 seconds
1. On the visit row, click **Record** (untick Telehealth if you are just reading aloud).
2. Read this slowly, twice: *"This is a made-up test. Alpha Testcase is a fictional person. She says her mood has been low for two weeks and she is sleeping about five hours a night. She denies any thoughts of self-harm. The plan is to continue sertraline fifty milligrams daily and follow up in four weeks."*
3. Click **Stop**. Watch it transcribe.

## 6. Check saving and upload
- **Online:** the visit shows as uploaded and nothing stays in the local queue.
- **Offline test:** turn Wi-Fi off, record 10 seconds, Stop. You should see **"Saved on this Mac, will retry"**. Turn Wi-Fi on and click **Retry all**. The queue should clear.

## 7. See the note
Open the staging web app, go to Notes, open that visit, press **Generate**. A draft note should appear.

## 8. Try Feedback (staging, fake text only)
1. Click **Feedback** at the top. You see a list, newest first.
2. Click **New feedback**, choose **Feedback** or **Bug**, type a title and description, click **Save**. It appears at the top.
3. Dictation: click **New feedback** > **Dictate**, say "This is a made-up test. The Save button is hard to find on the schedule page." Click **Stop** and wait for "Dictation captured". Click **Turn into description**; the title and description fill in. Edit them, then **Save**. (No audio is saved; the dictation is dropped once turned into a description.)
4. Click **Edit** on your own item, change the title, **Save**. Other people's items have no Edit button.
5. Never put patient details in. If you see "may contain patient information", remove the details and save again.

## If something fails, send me
Only the exact **error message text** and which step number. Never send transcript text or anything with names.

## 8. Release check: queued data survives an app update (every Desktop release)
Automated (must pass before any rebuild; fake data only):
- `cd app/src-tauri && cargo test --lib queue::` runs `a_v1_0_queue_from_the_previous_build_still_opens_lists_and_reads` and `listing_and_reading_never_delete_or_rewrite_queued_files_even_with_the_wrong_key` against `src-tauri/tests/fixtures/queue-v1.0` (a queue written by the v1.0.19 build, fake text). If you change the queue file format, the encryption, or the Keychain item (`org.practice.notes`, item `vault`), keep these passing or add a migration that keeps the old files readable. Never regenerate the fixture to make a failing test pass.
- `npx vitest run tests/queue-survives-update.test.ts` checks the retry goes to the environment saved with the item and that nothing is deleted unless the server confirms.
- `git diff <previous release> HEAD -- app/src-tauri/src/queue.rs app/src-tauri/src/keystore.rs` should be empty, or reviewed line by line.
- Signing: `codesign -dr - "Practice Recorder.app"` must show the same `certificate leaf = H"eb350c3c973e6fdf017b65e7dd37dfea151db443"` as the previous release (a different certificate makes macOS ask again for Keychain access on first launch).
By hand (staging, fake data): install the previous release, record 10 seconds offline so it shows "Saved on this Mac", quit, install the new build over it, open it. The banner must still list the transcript and Retry all must send it after Wi-Fi is back.
See `docs/update-procedure.md` for the plain-language steps given to users.

## 9. Release check: old queued transcripts after the Production-only update
- Automated: `cargo test --lib queue::` (items recorded against staging/localhost still list and are kept) and `npx vitest run tests/queue-test-environment.test.ts` (those items are never sent, completed or discarded; Production items still upload; a 404 says "This visit is not in the Production app").
- By hand (fake data, Staging TEST build then the release build): record offline in the Staging TEST build is a separate data folder, so instead copy a v1.0.19/1.0.20 queue as in section 8. Open the release build: the banner must show "recorded against the test environment" with Export, Keep and Discard (Discard asks to confirm), and Production items must retry as before.
