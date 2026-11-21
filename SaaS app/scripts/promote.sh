#!/usr/bin/env bash
# One-command production promote. Stops on the first failed check. Same script runs from the GitHub workflow (promote-prod.yml,
# after the reviewer approves) or by hand from a signed-in gcloud. PROD ONLY, patient-data-safe: only counts/verdicts are printed.
#   SHA=<commit on main>  [DRY_RUN=1]  scripts/promote.sh        (run from the repo root; needs git, gcloud, docker, curl, python3)
# DRY_RUN=1 does every read-only check and the image build, then stops BEFORE backup, schema apply, deploy and traffic.
set -euo pipefail
P=bbc-practice-mgmt; STG=bbc-practice-mgmt-staging; REG=us-east4; SVC=practice-mgmt; JOB=bbc-schema-gate; SQL=bbc-pm-db-prod
REPO=$REG-docker.pkg.dev/$P/cloud-run-source-deploy; IMGN=practice-mgmt
DRY=${DRY_RUN:-0}; say() { echo "== $*"; }; die() { echo "PROMOTE STOPPED: $*" >&2; exit 1; }

say "0 inputs"
STG_REV=$(gcloud run services describe $SVC --project $STG --region $REG --format=json | python3 -c 'import sys,json;d=json.load(sys.stdin);print([x for x in d["status"]["traffic"] if x.get("percent",0)>0][0]["revisionName"])')
STG_COMMIT=$(gcloud run revisions describe "$STG_REV" --project $STG --region $REG --format='value(metadata.labels.commit)')
SHA=${SHA:-$STG_COMMIT}; [ -n "$SHA" ] || die "no SHA given and staging revision has no commit label"
git fetch -q origin main; SHA=$(git rev-parse "$SHA"); SHORT=${SHA:0:7}; echo "commit $SHORT, dry-run=$DRY"
[ -f HOLD ] && die "HOLD file exists in the repo: $(head -c 200 HOLD)"
git merge-base --is-ancestor "$SHA" origin/main || die "$SHORT is not on main"

say "1 staging must be serving this exact commit (the commit that was tested)"
[ "$STG_COMMIT" = "$SHORT" ] || die "staging serves commit '$STG_COMMIT', not $SHORT. Promote only what staging ran."

say "2 build image for prod (same Dockerfile as staging)"
( cd "SaaS app" && gcloud auth configure-docker $REG-docker.pkg.dev --quiet >/dev/null && docker build -q -t "$REPO/$IMGN:$SHORT" . && docker push -q "$REPO/$IMGN:$SHORT" )
IMG="$REPO/$IMGN:$SHORT"

runjob() { # $1=args string (comma list), $2=extra env updates (optional). Prints only GATE/APPLIED/DROP lines.
  gcloud run jobs update $JOB --project $P --region $REG --image "$IMG" --args="$1" ${2:+--update-env-vars=$2} --quiet >/dev/null
  EXE=$(gcloud run jobs execute $JOB --project $P --region $REG --wait --format='value(metadata.name)' 2>/dev/null) || true
  gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\" AND labels.\"run.googleapis.com/execution_name\"=\"$EXE\" AND textPayload:(\"GATE:\" OR \"APPLIED\" OR \"APPROVED DROP\")" \
    --project $P --freshness=20m --format='value(textPayload)' | sort -u
}
restore_job() { gcloud run jobs update $JOB --project $P --region $REG --args=tsx,scripts/schema-apply.ts --update-env-vars=PROD_CONFIRM=,BACKUP_ID= --quiet >/dev/null 2>&1 || true; }
trap restore_job EXIT

say "3 schema gate, dry run (read-only diff against prod)"
V=$(runjob "tsx,scripts/schema-apply.ts"); echo "$V"
echo "$V" | grep -q "GATE: FAIL" && die "schema gate FAILED (destructive or non-additive change). Fix on staging first."
echo "$V" | grep -q "GATE: PASS" || die "no gate verdict from the job; look at the job log"
PENDING=1; echo "$V" | grep -q "no schema changes" && PENDING=0

if [ "$DRY" = "1" ]; then say "dry run done: checks passed, image built, nothing deployed. schema changes pending: $PENDING"; exit 0; fi

say "4 on-demand backup before anything changes"
BACKUP_ID=$(gcloud sql backups create --instance $SQL --project $P --format='value(id)' 2>/dev/null | tail -1)
[ -n "$BACKUP_ID" ] || die "backup failed"; echo "backup $BACKUP_ID"

if [ "$PENDING" = "1" ]; then
  say "5 apply additive schema, then re-check: the database must now match schema.prisma (every column exists) BEFORE traffic"
  runjob "tsx,scripts/schema-apply.ts,--apply,--allow-prod" "PROD_CONFIRM=yes,BACKUP_ID=$BACKUP_ID" | tail -3
  V2=$(runjob "tsx,scripts/schema-apply.ts"); echo "$V2"
  echo "$V2" | grep -q "no schema changes" || die "database still differs from schema after apply; traffic NOT moved"
else say "5 no schema changes to apply"; fi

say "6 deploy new revision with no traffic, tagged and labeled commit=$SHORT"
PREV=$(gcloud run services describe $SVC --project $P --region $REG --format=json | python3 -c 'import sys,json;d=json.load(sys.stdin);print([x for x in d["status"]["traffic"] if x.get("percent",0)>0][0]["revisionName"])')
gcloud run deploy $SVC --project $P --region $REG --image "$IMG" --no-traffic --tag "c$SHORT" --update-labels "commit=$SHORT,env=production" --quiet >/dev/null
URL=$(gcloud run services describe $SVC --project $P --region $REG --format='value(status.traffic[].url)' | tr ';' '\n' | grep "c$SHORT" | head -1)
[ -n "$URL" ] || die "no tagged URL for the new revision"

say "7 smoke on the new revision (login 200, security headers, anonymous API refused)"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/login")" = "200" ] || die "login page not 200"
curl -sI "$URL/login" | tr -d '\r' | grep -qi '^content-security-policy:' || die "CSP header missing"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/desktop/v1/providers")" = "401" ] || die "anonymous desktop API did not return 401"

say "8 move traffic"
gcloud run services update-traffic $SVC --project $P --region $REG --to-latest --quiet >/dev/null
sleep 60
say "9 post-check: server errors in the last 2 minutes (count only)"
N=$(gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SVC\" AND httpRequest.status>=500" --project $P --freshness=2m --format='value(timestamp)' | wc -l | tr -d ' ')
echo "5xx in 2 min: $N"
if [ "$N" -gt 5 ]; then
  echo "TOO MANY ERRORS: rolling back to $PREV"; gcloud run services update-traffic $SVC --project $P --region $REG --to-revisions "$PREV=100" --quiet >/dev/null; die "rolled back to $PREV"
fi
say "DONE: production serves commit $SHORT. Rollback revision: $PREV. Backup: $BACKUP_ID"
