#!/bin/bash
# Builds Practice Recorder.app and signs it with the stable local identity (run make-dev-cert.sh once first).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
NAME="BBC Practice Recorder Dev"
if ! security find-identity -p codesigning | grep -q "$NAME"; then
  echo "No '$NAME' identity: run scripts/make-dev-cert.sh once. Building ad-hoc signed (Keychain prompts will repeat)." >&2
  npm run tauri build -- --bundles app
else
  APPLE_SIGNING_IDENTITY="$NAME" npm run tauri build -- --bundles app
  codesign -dv "src-tauri/target/release/bundle/macos/Practice Recorder.app" 2>&1 | grep -E "Authority|Signature"
fi
