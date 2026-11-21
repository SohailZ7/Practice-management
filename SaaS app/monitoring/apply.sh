#!/usr/bin/env bash
# Usage: ./apply.sh <project> <channel-id>   (channel = full name from `gcloud beta monitoring channels list`)
set -euo pipefail
P="${1:?project}"; C="${2:?channel}"
cd "$(dirname "$0")"
for f in http-5xx latency cloudsql-health app-error-log; do
  gcloud alpha monitoring policies create --project "$P" --policy-from-file "$f.json" --notification-channels "$C"
done
echo "Uptime check (uptime.json): fill host/project, then: gcloud monitoring uptime create (Console is simpler)."
