#!/bin/bash
# Publishes the signed Desktop app so running apps update themselves.
#   scripts/release.sh                 build from HEAD (must be on origin/main), sign the update, upload, switch latest.json
#   scripts/release.sh --dry-run       do everything except the upload (checks that would block are shown as warnings)
#   scripts/release.sh --rollback 1.0.5   point latest.json back at an already-uploaded version
# Safety: the release gate (scripts/release-gate.sh) must pass before any upload; only a clean checkout whose commit is on origin/main is published; versions are immutable (never overwritten);
# latest.json is written LAST, and the old one is kept as previous.json, so a rollback is one re-point.
# One-time setup (bucket, IAM, updater key) is in Desktop App/docs/auto-update-setup.md.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/Documents/Repos/Tools/google-cloud-sdk/bin:$PATH"
# Production and staging each have their own private bucket (staging must not read prod). Every release goes to both.
BUCKETS="${BBC_RELEASE_BUCKETS:-gs://bbc-practice-mgmt-desktop-releases gs://bbc-practice-mgmt-staging-desktop-releases}"
KEY="${BBC_UPDATER_KEY:-$HOME/.bbc-updater/updater.key}"
TARGET="darwin-aarch64"
MODE="release"; ROLLBACK_TO=""
case "${1:-}" in
  --dry-run) MODE="dry" ;;
  --rollback) MODE="rollback"; ROLLBACK_TO="${2:?usage: release.sh --rollback <version>}" ;;
  "") ;;
  *) echo "unknown option $1" >&2; exit 2 ;;
esac
say() { echo "[release] $*"; }
need() { command -v "$1" >/dev/null || { echo "missing tool: $1" >&2; exit 1; }; }
need gcloud; need jq

if [ "$MODE" = "rollback" ]; then
  for BUCKET in $BUCKETS; do
    gcloud storage ls "$BUCKET/releases/$ROLLBACK_TO/manifest.json" >/dev/null 2>&1 || { echo "version $ROLLBACK_TO is not in $BUCKET" >&2; exit 1; }
  done
  for BUCKET in $BUCKETS; do
    gcloud storage cp "$BUCKET/latest.json" "$BUCKET/previous.json" --quiet 2>/dev/null || true
    gcloud storage cp "$BUCKET/releases/$ROLLBACK_TO/manifest.json" "$BUCKET/latest.json" --cache-control="no-store" --quiet
  done
  say "latest.json now points at $ROLLBACK_TO in every bucket. Running apps switch to it within 30 minutes."
  exit 0
fi

# 1. Only pushed, clean work.
problems=()
git fetch -q origin main
[ -z "$(git status --porcelain -- . ':!target')" ] || problems+=("working tree has uncommitted changes")
git merge-base --is-ancestor HEAD origin/main || problems+=("HEAD $(git rev-parse --short HEAD) is not on origin/main (push first, with Sohail's approval)")
if [ ${#problems[@]} -gt 0 ]; then
  for p in "${problems[@]}"; do if [ "$MODE" = dry ]; then say "WARNING: $p"; else say "BLOCKED: $p"; fi; done
  [ "$MODE" = dry ] || exit 1
fi
[ -f "$KEY" ] || { echo "updater signing key not found at $KEY" >&2; exit 1; }
VERSION="$(jq -r .version package.json)"
SHA="$(git rev-parse --short HEAD)"
if [ "$MODE" = release ]; then for BUCKET in $BUCKETS; do
  if gcloud storage ls "$BUCKET/releases/$VERSION/manifest.json" >/dev/null 2>&1; then
    echo "version $VERSION is already published in $BUCKET. Run scripts/bump-version.sh \"what changed\", commit, push, then release." >&2; exit 1
  fi
done; fi
say "building v$VERSION ($SHA)"

# 2. Build and sign the app (also bakes the commit into the page).
./scripts/build-signed.sh >/tmp/bbc-release-build.log 2>&1 || { tail -20 /tmp/bbc-release-build.log; exit 1; }
APP="$HOME/PracticeRecorder-signed/Practice Recorder.app"
# The page is compiled into the binary, so the freshly built dist/ (made by the build above) is what carries the commit.
grep -q "$VERSION ($SHA)" dist/assets/index-*.js || { echo "built app does not carry $VERSION ($SHA)" >&2; exit 1; }
[ "$(defaults read "$APP/Contents/Info" CFBundleShortVersionString)" = "$VERSION" ] || { echo "Info.plist version mismatch" >&2; exit 1; }

# 2b. Release gate: model survives an update, banner path, staging reachable. Any failure stops here, before any upload.
PREV_APP=""; PREV_DMG="$(ls -t "$HOME/PracticeRecorder-signed/versions/"*.dmg 2>/dev/null | head -1 || true)"
[ -z "$PREV_DMG" ] || PREV_APP="$PREV_DMG"
./scripts/release-gate.sh "$APP" "$PREV_APP" || { echo "[release] BLOCKED by the release gate. Nothing was uploaded." >&2; exit 1; }

# 3. Update archive (what running apps download) + its signature, and the DMG (what a new Mac installs from).
OUT="$(mktemp -d "${TMPDIR:-/tmp}/bbc-release.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT
TAR="$OUT/Practice Recorder.app.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$TAR" -C "$(dirname "$APP")" "Practice Recorder.app"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${BBC_UPDATER_KEY_PASSWORD:-}" \
  npx --no-install tauri signer sign "$TAR" >/dev/null
SIG="$(cat "$TAR.sig")"
STAGE="$OUT/dmg"; mkdir -p "$STAGE"
ditto --norsrc --noextattr --noqtn "$APP" "$STAGE/Practice Recorder.app"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/Practice-Recorder-$VERSION.dmg"
hdiutil create -quiet -volname "Practice Recorder" -srcfolder "$STAGE" -ov -format UDZO "$DMG"

NOTES="$(grep -m1 "$VERSION" ../CHANGELOG.md 2>/dev/null | sed 's/^[-* ]*//' | cut -c1-300 || true)"
jq -n --arg v "$VERSION" --arg sha "$SHA" --arg notes "$NOTES" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg sig "$SIG" \
  --arg obj "releases/$VERSION/Practice Recorder.app.tar.gz" --arg dmg "releases/$VERSION/Practice-Recorder-$VERSION.dmg" --arg t "$TARGET" \
  '{version:$v,commit:$sha,notes:$notes,pub_date:$date,platforms:{($t):{signature:$sig,object:$obj}},dmg:$dmg}' > "$OUT/manifest.json"
say "built: update archive $(du -h "$TAR" | cut -f1), dmg $(du -h "$DMG" | cut -f1)"

if [ "$MODE" = dry ]; then say "dry run: not uploaded. Manifest:"; jq -c 'del(.platforms[].signature)' "$OUT/manifest.json"; exit 0; fi

# 4. Keep a local copy of every released DMG (version + commit in the name), then upload: version folder first, latest.json last.
ARCHIVE="$HOME/PracticeRecorder-signed/versions"; mkdir -p "$ARCHIVE"
cp "$DMG" "$ARCHIVE/Practice-Recorder-$VERSION-$SHA.dmg"
say "archived $ARCHIVE/Practice-Recorder-$VERSION-$SHA.dmg"
for BUCKET in $BUCKETS; do
  gcloud storage cp "$TAR" "$DMG" "$BUCKET/releases/$VERSION/" --quiet
  gcloud storage cp "$OUT/manifest.json" "$BUCKET/releases/$VERSION/manifest.json" --quiet
  gcloud storage cp "$BUCKET/latest.json" "$BUCKET/previous.json" --quiet 2>/dev/null || say "no earlier latest.json in $BUCKET (first release)"
  gcloud storage cp "$OUT/manifest.json" "$BUCKET/latest.json" --cache-control="no-store" --quiet
  say "published v$VERSION ($SHA) to $BUCKET"
done
say "Running apps update within 30 minutes. Roll back with: scripts/release.sh --rollback <old version>"
