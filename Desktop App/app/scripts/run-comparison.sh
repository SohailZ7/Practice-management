#!/bin/zsh
# Runs the 12-case synthetic comparison on THIS Mac and saves results you can send back.
# Usage:  scripts/run-comparison.sh <label> <runs> <model> [<model> ...]
#   e.g.  scripts/run-comparison.sh mac24gb 2 qwen2.5:14b-instruct gemma3:12b llama3.1:8b phi4
# Safe by design: only invented (synthetic) visits are used. Nothing leaves this Mac except the model downloads.
set -u
label="${1:?label, e.g. mac24gb}"; runs="${2:?runs per case, e.g. 2}"; shift 2
[ $# -ge 1 ] || { echo "give at least one model"; exit 1; }
cd "$(dirname "$0")/.."

[ "$(uname -s)" = Darwin ] || { echo "macOS only"; exit 1; }
command -v ollama >/dev/null || { echo "install Ollama first: brew install ollama"; exit 1; }
command -v node >/dev/null || { echo "install Node 20+ first"; exit 1; }
[ -d node_modules ] || npm install
curl -s http://127.0.0.1:11434/api/tags >/dev/null || { echo "Ollama is not running. Start it: brew services start ollama"; exit 1; }

out="tests/eval/results/$(date +%F)-$label"
mkdir -p "$out"
hw="$out/hardware.txt"
{
  echo "date: $(date)"; echo "chip: $(sysctl -n machdep.cpu.brand_string)"
  echo "memory_gb: $(( $(sysctl -n hw.memsize) / 1073741824 ))"
  echo "macos: $(sw_vers -productVersion)"; echo "ollama: $(ollama --version 2>&1 | tail -1)"
  echo "free_disk: $(df -h ~ | tail -1 | awk '{print $4}')"
} > "$hw"
cat "$hw"

for model in "$@"; do
  echo "=== $model"
  ollama pull "$model" || { echo "SKIPPED $model (pull failed)" | tee -a "$out/skipped.txt"; continue; }
  echo "swap before: $(sysctl -n vm.swapusage)" >> "$out/memory.txt"
  SPIKE_DIR="$out" SPIKE_MODELS="$model" SPIKE_RUNS="$runs" npx vitest run tests/model-compare.integration.test.ts 2>&1 | grep -E "run [0-9]|Tests |Error" | tee -a "$out/progress.txt"
  { echo "--- $model after run"; ollama ps; echo "swap after: $(sysctl -n vm.swapusage)"; memory_pressure | tail -1; } >> "$out/memory.txt"
  ollama stop "$model" >/dev/null 2>&1
done

# Rebuild the report from everything saved (scores are recomputed from the saved drafts).
SPIKE_DIR="$out" SPIKE_MODELS="$1" SPIKE_RUNS="$runs" npx vitest run tests/model-compare.integration.test.ts >/dev/null 2>&1
echo; echo "Done. Send back the folder: Desktop App/app/$out"
echo "Summary: $out/report.md   Memory use: $out/memory.txt"
