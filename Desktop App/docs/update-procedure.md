# Updating Practice Recorder when a transcript is saved on your Mac (plain-language steps)

Why this is safe: an update replaces only the app. Saved transcripts live in a separate folder
(`~/Library/Application Support/PracticeNotes/queue`) and are locked with a key in your Mac's Keychain
(item `org.practice.notes`). Updates are signed with the same certificate, so the new version opens the same key
and the same folder. The app never deletes a saved transcript until the practice app confirms it received it.

## Before you install
1. Open Practice Recorder. If a banner says "N transcripts are saved on this Mac", click **Retry all** and read the
   reason it now shows (for example "Signed out: sign in again to Production"). Fix that first if you can (sign in in Setup).
2. If the banner is gone, you are done: nothing is waiting. Quit the app and install the update.
3. If the banner stays, do NOT delete anything. Go to step "Back up" and then install the update anyway; the saved
   transcripts stay and are retried by the new version.

## Back up (only if a transcript is still saved)
1. In Finder choose Go > Go to Folder and paste `~/Library/Application Support/PracticeNotes`.
2. Copy the whole **PracticeNotes** folder to your Desktop (hold Option and drag). Do not open the files; they are encrypted.
3. Important: the copy can only be opened with the key in your Keychain. Do not delete the Keychain item
   "org.practice.notes" (Keychain Access app) and do not erase or reset this Mac's login keychain. If this Mac is replaced,
   ask Sohail before wiping it.

## Install
1. Quit Practice Recorder. Open the new DMG and drag the app into Applications, choosing Replace.
2. Open it. If macOS asks for Keychain access, enter your Mac password and choose **Always Allow** (it should not ask).
3. Setup should show the new version. Sign in to Production if asked.

## If the banner is still there after updating
1. Click **Retry all**. Read the reason shown next to it:
   - Signed out: use the **Sign in to Production** button, then Retry all.
   - No Notes edit access: ask an admin to give your account Notes edit access.
   - That visit is not in Production: the visit may have been recorded against a different environment or no longer exists; tell Sohail, do not delete.
   - Cannot reach the practice app: check Wi-Fi/VPN and retry later.
2. Still stuck: take a screenshot of the banner (no patient names are in it), keep the PracticeNotes backup, and send it to Sohail.
   Never use the Delete/discard option on a saved transcript unless Sohail says to.
