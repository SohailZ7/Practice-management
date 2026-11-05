#!/bin/bash
# Builds Practice Recorder.app, then signs it with the stable local identity (run make-dev-cert.sh once first).
# Tauri's own signing is skipped: the repo lives in an iCloud-synced folder whose extended attributes break codesign.
# The app is copied with ditto (no xattrs) into a clean folder, signed there, and left next to the original build.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
NAME="BBC Practice Recorder Dev"
unset APPLE_SIGNING_IDENTITY
npm run tauri build -- --bundles app
SRC="src-tauri/target/release/bundle/macos/Practice Recorder.app"
OUT="src-tauri/target/release/bundle/signed"
rm -rf "$OUT"; mkdir -p "$OUT"
ditto --norsrc --noextattr --noqtn "$SRC" "$OUT/Practice Recorder.app"
xattr -cr "$OUT/Practice Recorder.app"
if security find-identity -p codesigning | grep -q "$NAME"; then ID="$NAME"; else
  echo "No '$NAME' identity (run scripts/make-dev-cert.sh once): signing ad-hoc; Keychain prompts will repeat." >&2; ID="-"; fi
codesign --force --deep --sign "$ID" "$OUT/Practice Recorder.app"
codesign -dv "$OUT/Practice Recorder.app" 2>&1 | grep -E "Authority|Signature|Identifier"
codesign --verify --deep --strict "$OUT/Practice Recorder.app" && echo "signature OK: $OUT/Practice Recorder.app"
