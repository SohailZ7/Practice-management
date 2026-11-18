#!/bin/bash
# Builds the separate "Practice Recorder (Staging TEST)" app for agents who need to test against staging.
# It has its own bundle id (org.practice.notes.stagingtest), Keychain item, data folder (PracticeNotesStagingTest), a red
# banner, no Production address and no auto-update. NEVER install it on a staff Mac. Output: ~/PracticeRecorder-StagingTEST/
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
NAME="BBC Practice Recorder Dev"
unset APPLE_SIGNING_IDENTITY
rm -rf src-tauri/target/release/bundle/macos
VITE_STAGING_TEST=1 npm run tauri build -- --bundles app --features staging-test --config src-tauri/tauri.staging-test.conf.json
SRC="src-tauri/target/release/bundle/macos/Practice Recorder (Staging TEST).app"
OUT="$HOME/PracticeRecorder-StagingTEST"
rm -rf "$OUT"; mkdir -p "$OUT"
ditto --norsrc --noextattr --noqtn "$SRC" "$OUT/Practice Recorder (Staging TEST).app"
xattr -cr "$OUT/Practice Recorder (Staging TEST).app"
if security find-identity -p codesigning | grep -q "$NAME"; then ID="$NAME"; else ID="-"; fi
codesign --force --deep --sign "$ID" "$OUT/Practice Recorder (Staging TEST).app"
codesign --verify --deep --strict "$OUT/Practice Recorder (Staging TEST).app" && echo "signature OK"
rm -rf "$SRC"
echo "Built STAGING TEST app at $OUT. Not for staff Macs."
