#!/bin/sh
# Copies the Whisper model into src-tauri/resources/models/ so `tauri build` bundles it.
# The file is git-ignored (487 MB). Source defaults to the spike's download; pass another path as $1.
set -e
SRC="${1:-$HOME/Library/Application Support/PracticeNotesSpike/models/ggml-small.en.bin}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/models"
[ -f "$SRC" ] || { echo "Model not found: $SRC" >&2; exit 1; }
mkdir -p "$DEST"
cp "$SRC" "$DEST/ggml-small.en.bin"
echo "Placed $(basename "$SRC") in $DEST"
