#!/usr/bin/env bash
# Release A runner for the Production agent. Runs the automatic gates of MAIN-PROMPT section 2, safeguard 8, in order, and
# STOPS at the first red gate. Counts and hashes only. Never retries, never improvises, never deletes production rows.
#
#   scripts/release-a-run.sh --env staging                  full run against staging (fake data), real jobs
#   scripts/release-a-run.sh --env production ...           see docs/release-a-runbook.md for the required inputs
#   add --print-only to show every command without running anything
#
# Needs: gcloud signed in, run from "SaaS app" in a clean checkout, the Release A commit in RELEASE_A_COMMIT.
# Production ALSO needs: SOHAIL_APPROVAL_TYPED=yes (set only if you SAW his approval typed in the Production agent's own
# session), PROMOTE_VERIFIED=yes (promote gate 3 passed tonight), BACKUP_ID (verified on-demand backup), SCRATCH_SECRET and
# SCRATCH_HOST (the restored scratch database's DATABASE_URL secret and host).
set -uo pipefail
ENVN=""; PRINT=0
while [ $# -gt 0 ]; do case "$1" in --env) ENVN="$2"; shift;; --print-only) PRINT=1;; *) echo "unknown option $1"; exit 2;; esac; shift; done
STAMP=${STAMP:-$(date +%Y%m%d)}; R=us-east4; SVC=practice-mgmt
case "$ENVN" in
  staging)    P=bbc-practice-mgmt-staging; JOB=bbc-schema-push; HOST=10.85.0.3;;
  production) P=bbc-practice-mgmt; JOB=bbc-schema-gate; HOST=10.27.192.3;;
  *) echo "pass --env staging|production"; exit 2;;
esac
say()  { echo "[release-a $(date +%H:%M:%S)] $*"; }
stop() { say "STOP: $*"; say "No further production step will run. Report in schedule-billing-progress.md (counts only)."; exit 1; }
[ -n "${RELEASE_A_COMMIT:-}" ] || stop "RELEASE_A_COMMIT is not set (the commit that contains Release A)"
if [ "$ENVN" = production ]; then
  [ "${SOHAIL_APPROVAL_TYPED:-}" = yes ] || stop "Sohail's typed approval was not seen in this session (safeguard 7): do staging work only"
  [ "${PROMOTE_VERIFIED:-}" = yes ]      || stop "the promote has not passed its gate tonight (safeguard 8.3): the migration never runs on that night"
  [ -n "${BACKUP_ID:-}" ] && [ -n "${SCRATCH_SECRET:-}" ] && [ -n "${SCRATCH_HOST:-}" ] || stop "BACKUP_ID, SCRATCH_SECRET and SCRATCH_HOST are required"
fi

# Job settings are reset on EVERY step so nothing leaks from one step to the next (a confirm phrase, the scratch secret).
# Arguments use gcloud's custom list delimiter "@" because the --before JSON contains commas.
JOBSECRET=()
[ "$ENVN" = production ] && JOBSECRET=(--set-secrets "DATABASE_URL=DATABASE_URL:latest")
ALLCONF=(PROD_CONFIRM SCRATCH_CONFIRM BACKUP_ID)
# envsetup "K=V,K=V" -> --update-env-vars for those keys and --remove-env-vars for the confirm keys not in the list
envsetup() { local keep="$1" rm="" k; for k in "${ALLCONF[@]}"; do case ",$keep," in *",$k="*) ;; *) rm="$rm,$k";; esac; done
  ENVFLAGS=(--update-env-vars "$keep"); [ -n "$rm" ] && ENVFLAGS+=(--remove-env-vars "${rm#,}"); }

# runstep name "script@arg@arg" "ENV=1,K=V" [--set-secrets ...]: runs one script in the job, prints only its GATE/count lines,
# returns 1 if the job failed or any GATE line says FAIL.
runstep() {
  local name="$1" args="$2" keep="$3"; shift 3
  envsetup "$keep"
  local secrets=("${JOBSECRET[@]}"); [ $# -gt 0 ] && secrets=("$@")
  local upd=(gcloud run jobs update $JOB --project $P --region $R --image "$IMG" "--args=^@^tsx@scripts/$args" --max-retries 0 --quiet "${ENVFLAGS[@]}" "${secrets[@]}")
  local exe=(gcloud run jobs execute $JOB --project $P --region $R --wait)
  if [ $PRINT = 1 ]; then say "[$name] ${upd[*]}"; say "[$name] ${exe[*]}"; return 0; fi
  "${upd[@]}" >/dev/null 2>&1 || { say "[$name] could not set up the job"; return 1; }
  local out; out=$("${exe[@]}" 2>&1); local rc=$?
  local ex; ex=$(echo "$out" | grep -o 'Execution \[[^]]*\]' | head -1 | sed 's/Execution \[//;s/\]//')
  local logs="" i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    logs=$(gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\" AND labels.\"run.googleapis.com/execution_name\"=\"$ex\" AND (textPayload:\"GATE\" OR textPayload:\"_COUNTS\" OR textPayload:\"FINGERPRINT\" OR textPayload:\"APPLIED\" OR textPayload:\"SNAPSHOT\" OR textPayload:\"FAILED\" OR textPayload:\"REFUSED\" OR textPayload:\"unify failed\" OR textPayload:\"COPYBACK\" OR textPayload:\"ROLLBACK\" OR textPayload:\"RECORDING\" OR textPayload:\"BEFORE\")" --project $P --freshness=30m --order=asc --format='value(textPayload)' 2>/dev/null)
    [ -n "$logs" ] && break; sleep 5
  done
  echo "$logs" | cut -c1-400 | sed "s/^/  [$name] /"
  LAST_LOGS="$logs"
  [ $rc -eq 0 ] || return 1
  echo "$logs" | grep -q "GATE .*: FAIL" && return 1
  return 0
}
# Always leave the job without a confirm phrase or the scratch secret, whatever happened.
cleanup() { [ $PRINT = 1 ] && return; gcloud run jobs update $JOB --project $P --region $R --remove-env-vars PROD_CONFIRM,SCRATCH_CONFIRM,BACKUP_ID "${JOBSECRET[@]}" --quiet >/dev/null 2>&1; }
trap cleanup EXIT
LAST_LOGS=""
fieldof() { echo "$LAST_LOGS" | grep "^$1 " | head -1 | cut -d' ' -f2-; }

# ---- 0. what is live ----------------------------------------------------------------------------------------------
if [ $PRINT = 0 ]; then
  IMG=$(gcloud run services describe $SVC --project $P --region $R --format='value(spec.template.spec.containers[0].image)') || stop "cannot read the live image"
  LIVE=$(gcloud run services describe $SVC --project $P --region $R --format='value(spec.template.metadata.labels.commit)')
  say "live service image read; live commit label: ${LIVE:-none}"
  # CODE GATE: the live code must already hide migration-inserted Visits (it contains Release A), else the new Visits would show twice.
  if [ -z "$LIVE" ] || ! git merge-base --is-ancestor "$RELEASE_A_COMMIT" "$LIVE" 2>/dev/null; then stop "GATE code: FAIL (the live revision does not contain Release A; promote it first, the backfill inserts Visits that only Release A code hides)"; fi
  say "GATE code: PASS (live revision contains Release A)"
else IMG="<live image>"; fi
APPENV=APP_ENV=$ENVN
[ "$ENVN" = production ] && CONF="PROD_CONFIRM=WRITE-TO-PRODUCTION-$HOST" || CONF="STAGING=1"

# ---- 1. recording gate ---------------------------------------------------------------------------------------------
runstep recording "unify-recording-check.ts" "$APPENV" || stop "GATE recording: FAIL"

# ---- 2. backup gate: counts on production vs the restored scratch copy ----------------------------------------------
runstep prod-counts "unify-dryrun.ts" "$APPENV" || stop "could not read production counts"
PROD_COUNTS=$(fieldof TABLE_COUNTS); BEFORE_FP=$(fieldof FINGERPRINT); PLAN_COUNTS=$(fieldof DRYRUN_COUNTS)
if [ "$ENVN" = production ]; then
  runstep scratch-counts "unify-dryrun.ts@--scratch-copy" "APP_ENV=development,SCRATCH_CONFIRM=SCRATCH-COPY-$SCRATCH_HOST" --set-secrets "DATABASE_URL=$SCRATCH_SECRET:latest" || stop "could not read the scratch copy (restore it first)"
  SCRATCH_COUNTS=$(fieldof TABLE_COUNTS)
  [ $PRINT = 1 ] || npx tsx scripts/unify-compare-counts.ts "$PROD_COUNTS" "$SCRATCH_COUNTS" || stop "GATE backup: FAIL"
  # ---- 3. rehearsal gate on the scratch copy ----
  runstep rehearsal "unify-rehearse.ts@--scratch-copy@--with-rollback" "APP_ENV=development,SCRATCH_CONFIRM=SCRATCH-COPY-$SCRATCH_HOST" --set-secrets "DATABASE_URL=$SCRATCH_SECRET:latest" || stop "GATE rehearsal: FAIL (do not touch production)"
fi
[ $PRINT = 1 ] && BEFORE_JSON='{"counts":<prod counts>,"fp":<prod fingerprint>}' || BEFORE_JSON="{\"counts\":$PROD_COUNTS,\"fp\":$BEFORE_FP}"

# ---- 4. snapshot ---------------------------------------------------------------------------------------------------
runstep snapshot "unify-snapshot.ts@--stamp@$STAMP@--allow-prod" "$APPENV,$CONF" || stop "GATE snapshot: FAIL"

# ---- 5. columns (additive, gated; a no-op when the promote already applied them) ----------------------------------------
if [ "$ENVN" = production ]; then SCHEMA="schema-apply.ts@--apply@--allow-prod"; SCHEMAENV="$APPENV,$CONF,BACKUP_ID=$BACKUP_ID"; else SCHEMA="schema-apply.ts@--apply"; SCHEMAENV="$APPENV"; fi
runstep schema "$SCHEMA" "$SCHEMAENV" || stop "schema gate FAIL (non-additive or error)"

# ---- 6. dry run, then the backfill -------------------------------------------------------------------------------------
runstep dryrun "unify-backfill.ts" "$APPENV" || stop "GATE backfill-dryrun: FAIL"
if [ $PRINT = 1 ]; then INSERTS="<toInsert>"; else INSERTS=$(echo "$LAST_LOGS" | grep '^DRYRUN_COUNTS' | head -1 | sed 's/.*"toInsert":\([0-9]*\).*/\1/'); fi
runstep backfill "unify-backfill.ts@--apply@--allow-prod@--expect-inserts@$INSERTS" "$APPENV,$CONF" || stop "GATE backfill: FAIL"

# ---- 7. post-run check; one copy-back allowed, a second failure is Sohail's morning decision ----------------------------------
VERIFY="unify-verify.ts@--stamp@$STAMP@--before@$BEFORE_JSON@--expect-inserts@$INSERTS"
if ! runstep verify "$VERIFY" "$APPENV"; then
  say "post-run check RED: copying back ONLY rows that differ from the snapshot"
  runstep copyback "unify-copyback.ts@--stamp@$STAMP@--allow-prod" "$APPENV,$CONF" || stop "copy-back failed: restore from the verified backup is Sohail's morning decision"
  runstep verify2 "$VERIFY" "$APPENV" || stop "second post-run check failed: restore from the verified backup is Sohail's morning decision"
fi
say "GATE release-a: PASS (all gates green). Snapshot tables _snap_${STAMP}_* kept at least 7 days. Write the morning report."
