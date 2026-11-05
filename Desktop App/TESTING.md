# Testing the Practice Recorder on your Mac (staging, fake data only)

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

## 3. Allow Microphone and Screen Recording
1. When macOS asks for **Microphone**, click Allow.
2. For a Telehealth visit it also needs **Screen Recording** (for speaker audio): System Settings > Privacy & Security > Screen Recording, switch on Practice Recorder, then quit and reopen the app.
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
