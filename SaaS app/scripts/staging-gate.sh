#!/usr/bin/env bash
# Pre-promote gate, staging only. Runs EVERY smoke step with nothing skipped:
#   1) makes fake @bbc.invalid users + tokens via the staging schema job, 2) runs the anonymous and signed-in checks,
#   3) revokes the tokens and restores the job. Needs gcloud signed in with access to bbc-practice-mgmt-staging.
# Usage: scripts/staging-gate.sh   (run from "SaaS app"; the candidate revision with this script must already be deployed)
set -uo pipefail
P=bbc-practice-mgmt-staging; REG=us-east4; JOB=bbc-schema-push; SVC=practice-mgmt
BASE=$(gcloud run services describe $SVC --project $P --region $REG --format='value(status.url)')
IMG=$(gcloud run services describe $SVC --project $P --region $REG --format='value(spec.template.spec.containers[0].image)')
TOK=$(mktemp); trap 'rm -f "$TOK"; gcloud run jobs update $JOB --project $P --region $REG --args=tsx,scripts/schema-apply.ts --quiet >/dev/null 2>&1' EXIT
runjob() { gcloud run jobs update $JOB --project $P --region $REG --image "$IMG" --args="tsx,scripts/staging-smoke-users.ts,$1" --quiet >/dev/null && gcloud run jobs execute $JOB --project $P --region $REG --wait >/dev/null 2>&1; }
runjob create || { echo "could not create smoke users"; exit 2; }
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="'$JOB'" AND textPayload:"SMOKE_TOKENS"' --project $P --limit 1 --freshness=15m --format='value(textPayload)' | sed 's/^SMOKE_TOKENS //' > "$TOK"
rc=0
SMOKE_BASE=$BASE SYNTHETIC_KEY=${SYNTHETIC_KEY:-} PROD_BASE=${PROD_BASE:-} DESKTOP_TOKEN=$(python3 -c "import json,sys;print(json.load(open('$TOK'))['edit'])") npx tsx scripts/staging-smoke.ts || rc=1
SMOKE_BASE=$BASE SMOKE_TOKENS_FILE=$TOK npx tsx scripts/staging-live.ts || rc=1
runjob revoke
exit $rc
