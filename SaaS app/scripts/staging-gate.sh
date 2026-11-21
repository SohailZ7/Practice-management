#!/usr/bin/env bash
# Pre-promote gate, staging only. Runs EVERY smoke step with nothing skipped:
#   1) makes fake @bbc.invalid users + tokens via the staging schema job, 2) runs the anonymous and signed-in checks,
#   3) revokes the tokens and restores the job, 4) runs the screen regression suite (npm run test:screens) on this commit. Needs gcloud signed in with access to bbc-practice-mgmt-staging.
# Usage: scripts/staging-gate.sh   (run from "SaaS app"; the candidate revision with this script must already be deployed)
set -uo pipefail
P=bbc-practice-mgmt-staging; REG=us-east4; JOB=bbc-schema-push; SVC=practice-mgmt
BASE=$(gcloud run services describe $SVC --project $P --region $REG --format='value(status.url)')
IMG=$(gcloud run services describe $SVC --project $P --region $REG --format='value(spec.template.spec.containers[0].image)')
TOK=$(mktemp); trap 'rm -f "$TOK"; gcloud run jobs update $JOB --project $P --region $REG --args=tsx,scripts/schema-apply.ts --quiet >/dev/null 2>&1' EXIT
RUN=$(date +%s)-$$
runjob() { gcloud run jobs update $JOB --project $P --region $REG --image "$IMG" --args="tsx,scripts/staging-smoke-users.ts,$1,$RUN" --quiet >/dev/null && gcloud run jobs execute $JOB --project $P --region $REG --wait >/dev/null 2>&1; }
runjob create || { echo "could not create smoke users"; exit 2; }
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="'$JOB'" AND textPayload:"SMOKE_TOKENS '$RUN' "' --project $P --limit 1 --freshness=30m --format='value(textPayload)' | sed "s/^SMOKE_TOKENS $RUN //" > "$TOK"
# Transition only: the deployed image may predate the run id (old job prints "SMOKE_TOKENS {json}"); then take the newest line from the last 5 minutes.
[ -s "$TOK" ] || gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="'$JOB'" AND textPayload:"SMOKE_TOKENS {"' --project $P --limit 1 --freshness=5m --format='value(textPayload)' | sed 's/^SMOKE_TOKENS //' > "$TOK"
[ -s "$TOK" ] || { echo "no SMOKE_TOKENS line for run $RUN (log delay?); rerun is safe now"; exit 2; }
# The synthetic upload key is a plain env var on the staging service; read it so the upload check is not skipped.
[ -n "${SYNTHETIC_KEY:-}" ] || SYNTHETIC_KEY=$(gcloud run services describe $SVC --project $P --region $REG --format=json | python3 -c 'import sys,json;[print(e.get("value","")) for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env",[]) if e["name"]=="SYNTHETIC_KEY"]')
rc=0
SMOKE_BASE=$BASE SYNTHETIC_KEY=${SYNTHETIC_KEY:-} PROD_BASE=${PROD_BASE:-} DESKTOP_TOKEN=$(python3 -c "import json,sys;print(json.load(open('$TOK'))['edit'])") npx tsx scripts/staging-smoke.ts || rc=1
SMOKE_BASE=$BASE SMOKE_TOKENS_FILE=$TOK npx tsx scripts/staging-live.ts || rc=1
runjob revoke
# 4) Screen regression suite (every page: renders, layout, overflow, console errors, core actions) on THIS exact commit, against a
#    local throwaway database with synthetic data. Needs local Postgres (docker compose up -d db) and Chrome. Any failure fails the gate.
echo "== screen regression suite @ $(git rev-parse --short HEAD) =="
E2E_PROD=1 npx playwright test || { echo "SCREEN REGRESSION SUITE FAILED (a test listed as flaky above passed on retry; a failure here failed twice): do not promote"; rc=1; }
echo "screen-suite-commit: $(git rev-parse HEAD)"
exit $rc
