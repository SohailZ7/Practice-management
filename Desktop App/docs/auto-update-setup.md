# Desktop auto-update: one-time setup (Sohail)

How it works: `app/scripts/release.sh` (run after a push) builds and signs the app, uploads the update archive and the DMG to a
private Cloud Storage bucket, and writes `latest.json` last. The practice app (SaaS) serves an authenticated feed
`GET /api/desktop/v1/update/<target>/<current_version>` that reads `latest.json` and answers `204` (up to date) or
`200 {version, notes, pub_date, url, signature}` where `url` is a short-lived signed link. Running apps check every 30 minutes,
show "Update available", and install after a 10 second countdown, never during a recording or a send.

## One-time commands (run once, in this order)
```bash
# 1. Two private buckets (prod project holds the prod one; staging has its own so staging never reads prod)
gcloud storage buckets create gs://bbc-practice-mgmt-desktop-releases --project bbc-practice-mgmt --location us-east4 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets create gs://bbc-practice-mgmt-staging-desktop-releases --project bbc-practice-mgmt-staging --location us-east4 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://bbc-practice-mgmt-desktop-releases --versioning
gcloud storage buckets update gs://bbc-practice-mgmt-staging-desktop-releases --versioning

# 2. Each web app (its Cloud Run service account) reads its own bucket. Check the account first:
#    gcloud run services describe practice-mgmt --region us-east4 --project <project> --format='value(spec.template.spec.serviceAccountName)'
gcloud storage buckets add-iam-policy-binding gs://bbc-practice-mgmt-desktop-releases --member=serviceAccount:pm-run@bbc-practice-mgmt.iam.gserviceaccount.com --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding gs://bbc-practice-mgmt-staging-desktop-releases --member=serviceAccount:pm-run@bbc-practice-mgmt-staging.iam.gserviceaccount.com --role=roles/storage.objectViewer

# 3. Each web app may sign download links as itself
gcloud iam service-accounts add-iam-policy-binding pm-run@bbc-practice-mgmt.iam.gserviceaccount.com --project bbc-practice-mgmt --member=serviceAccount:pm-run@bbc-practice-mgmt.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator
gcloud iam service-accounts add-iam-policy-binding pm-run@bbc-practice-mgmt-staging.iam.gserviceaccount.com --project bbc-practice-mgmt-staging --member=serviceAccount:pm-run@bbc-practice-mgmt-staging.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator

# 4. The uploader (your own gcloud login, sohail30@gmail.com) may write to both buckets
gcloud storage buckets add-iam-policy-binding gs://bbc-practice-mgmt-desktop-releases --member=user:sohail30@gmail.com --role=roles/storage.objectAdmin
gcloud storage buckets add-iam-policy-binding gs://bbc-practice-mgmt-staging-desktop-releases --member=user:sohail30@gmail.com --role=roles/storage.objectAdmin
# 5. Tell each web app its bucket and the account that signs download links (two env vars each)
gcloud run services update practice-mgmt --project bbc-practice-mgmt --region us-east4 --update-env-vars DESKTOP_RELEASE_BUCKET=bbc-practice-mgmt-desktop-releases,DESKTOP_RELEASE_SIGNER=pm-run@bbc-practice-mgmt.iam.gserviceaccount.com
gcloud run services update practice-mgmt --project bbc-practice-mgmt-staging --region us-east4 --update-env-vars DESKTOP_RELEASE_BUCKET=bbc-practice-mgmt-staging-desktop-releases,DESKTOP_RELEASE_SIGNER=pm-run@bbc-practice-mgmt-staging.iam.gserviceaccount.com
```
The SaaS agent adds the server code and env var (see `context/md-files/desktop-distribution-setup.md`). Every release also
keeps the DMG locally in `~/PracticeRecorder-signed/versions/` as `Practice-Recorder-<version>-<sha>.dmg`.

Spend: storage is about 1 GB per release (a few cents a month); downloads are egress (about 0.5 GB per person per update).

## Update signing key
Generated at `~/.bbc-updater/updater.key` (mode 600, no password, outside every repo and iCloud). The public half is in
`tauri.conf.json`. Back the private key up into the password manager now: if it is lost, installed apps can never be updated again
and everyone must reinstall. Rotating it also means a reinstall.

## First install
v1.0.5 and older have no updater. Everyone installs the first updater-enabled DMG (v1.0.6 or later) by hand once, from Drive.
After that, updates are automatic. A new Mac still needs the one-time Gatekeeper step (System Settings > Privacy & Security >
Open Anyway) until Apple Developer ID notarization exists; updates themselves are not quarantined.

## Publish and roll back
```bash
cd "Desktop App/app" && scripts/release.sh              # from a pushed origin/main commit only
scripts/release.sh --rollback 1.0.5                     # re-point latest.json at an uploaded version (apps switch within 30 min)
```

## The transcription model and the release gate

- The Whisper model (`ggml-small.en.bin`, 487,614,201 bytes) is kept in `~/Library/Application Support/PracticeNotes/models/`, outside the app, so an update can never remove it. On launch the app checks the file's size; a model found only inside an old bundle is copied there once.
- If it is missing, Visits shows a banner with **Download model** (resumable, SHA-256 checked) and Record stays off until it is there. Setup shows "Transcription model: found/missing".
- `scripts/release.sh` runs `scripts/release-gate.sh` before any upload. It fails the release if: tsc, vitest or cargo tests fail; an update swap loses the model or the model does not transcribe a test tone; a clean profile does not report a missing model correctly; staging is unreachable. Set `BBC_STAGING_TOKEN` for a signed-in staging call (the Google sign-in itself needs a person).
- **Roll the feed back (one command, both buckets):** `scripts/release.sh --rollback <version>`, e.g. `scripts/release.sh --rollback 1.0.17`. Every version stays in `releases/<version>/`, and the previous `latest.json` is kept as `previous.json`.
