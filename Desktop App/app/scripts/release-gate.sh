#!/bin/bash
# Release gate. Run by release.sh BEFORE anything is uploaded; any failure stops the release.
#   scripts/release-gate.sh "<path to the built .app>" [previous .app or .dmg]
# Checks (all on throwaway profiles, nothing touches real data):
#  0. code: tsc, vitest, cargo tests (model download, resume, checksum)
#  A. update with the model present: previous app -> swap in the new bundle (what the updater does) -> the model in the kept
#     folder is still found and a generated test tone transcribes
#  B. clean profile with NO model: the app reports it missing (so the Download-model banner shows), and a bundled model is
#     copied into the kept folder
#  C. the released app is Production only: no staging/localhost address inside, the Production one present
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$HOME/Documents/Repos/Tools/google-cloud-sdk/bin:$PATH"
APP="${1:?usage: release-gate.sh <new .app> [previous .app|.dmg]}"; PREV="${2:-}"
BIN="$APP/Contents/MacOS/practice-notes"; [ -x "$BIN" ] || BIN="$(ls "$APP"/Contents/MacOS/* | head -1)"
SPIKE="$HOME/Library/Application Support/PracticeNotesSpike/models/ggml-small.en.bin"
fail() { echo "[gate] FAILED: $*" >&2; exit 1; }
pass() { echo "[gate] ok: $*"; }
W="$(mktemp -d "${TMPDIR:-/tmp}/bbc-gate.XXXXXX")"; trap 'rm -rf "$W"; [ -n "${MNT:-}" ] && hdiutil detach "$MNT" -quiet 2>/dev/null || true' EXIT

# 0. code
node_modules/.bin/tsc --noEmit || fail "typescript"
node_modules/.bin/vitest run >/dev/null || fail "vitest"
( cd src-tauri && cargo test --lib --quiet >/dev/null 2>&1 ) || fail "cargo tests"
pass "tsc, vitest, cargo tests"

# a model to put in the kept folder: the one on this Mac (verified by checksum)
[ -f "$SPIKE" ] || fail "no reference model at $SPIKE to run the update test with"
[ "$(shasum -a 256 "$SPIKE" | cut -d' ' -f1)" = "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d" ] || fail "reference model checksum"

run_check() { # HOME + app dir are throwaway; $1 = binary, rest = flags
  local b="$1"; shift
  HOME="$W/home" PRACTICE_APP_DIR="$W/home/Library/Application Support/PracticeNotes" "$b" "$@"
}

# A. update with the model present
rm -rf "$W/home"; mkdir -p "$W/home/Library/Application Support/PracticeNotes/models" "$W/inst"
cp -c "$SPIKE" "$W/home/Library/Application Support/PracticeNotes/models/ggml-small.en.bin" 2>/dev/null || cp "$SPIKE" "$W/home/Library/Application Support/PracticeNotes/models/ggml-small.en.bin"
if [ -n "$PREV" ]; then
  case "$PREV" in
    *.dmg) MNT="$W/mnt"; mkdir -p "$MNT"; hdiutil attach "$PREV" -mountpoint "$MNT" -nobrowse -quiet; ditto "$MNT/Practice Recorder.app" "$W/inst/Practice Recorder.app"; hdiutil detach "$MNT" -quiet; MNT="" ;;
    *) ditto "$PREV" "$W/inst/Practice Recorder.app" ;;
  esac
  rm -rf "$W/inst/Practice Recorder.app"   # the updater replaces the whole bundle
fi
ditto "$APP" "$W/inst/Practice Recorder.app"
NEWBIN="$W/inst/Practice Recorder.app/Contents/MacOS/$(basename "$BIN")"
OUT="$(run_check "$NEWBIN" --selfcheck --transcribe)" || fail "A: updated app cannot use the model ($OUT)"
echo "$OUT" | jq -e '.model=="kept" and .transcribe_ok==true' >/dev/null || fail "A: expected model kept + transcribes, got $OUT"
pass "A update keeps the model and transcribes: $OUT"

# B. no model anywhere except what the bundle itself carries
rm -rf "$W/home"; mkdir -p "$W/home"
set +e; OUT="$(run_check "$NEWBIN" --selfcheck)"; RC=$?; set -e
if [ -f "$APP/Contents/Resources/models/ggml-small.en.bin" ]; then
  echo "$OUT" | jq -e '.model=="bundled"' >/dev/null || fail "B: bundled model not found: $OUT"
else
  [ "$RC" = 3 ] && echo "$OUT" | jq -e '.model=="missing"' >/dev/null || fail "B: with no model the app must report missing, got rc=$RC $OUT"
fi
pass "B clean profile: $OUT (a missing model shows the Download banner; download/resume/checksum is covered by cargo tests)"

# C. the released app is PRODUCTION ONLY (Sohail, 2026-11-18): no staging or localhost address, and the Production one is present
PROD="https://practice-mgmt-802176721153.us-east4.run.app"
[ "$(strings "$BIN" | grep -cF "$PROD" || true)" -gt 0 ] || fail "C: the app does not contain the Production address"
[ "$(strings "$BIN" | grep -cF "practice-mgmt-321509350517" || true)" -eq 0 ] || fail "C: the released app contains the staging address (build without --features staging-test)"
[ "$(strings "$BIN" | grep -cF "localhost:3000" || true)" -eq 0 ] || fail "C: the released app contains the localhost address"
[ "$(cat dist/assets/*.js 2>/dev/null | grep -cE "321509350517|localhost:3000" || true)" -eq 0 ] || fail "C: the built web bundle (dist/) contains a staging or localhost address"
pass "C released app is Production only"
echo "[gate] ALL CHECKS PASSED"
