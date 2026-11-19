# Release A runbook (appointment unification, additive)

Owner: SaaS agent. Executor: Production agent. Source rules: MAIN-PROMPT section 2 (safeguards 1 to 8). Counts and hashes only: no names, no transcripts, no commit hashes in reports.
Release A = nullable `Visit` columns + backfill. The app keeps reading ScheduleEntry. Release B (switch readers), dropping ScheduleEntry and any non-additive change are NOT part of this and never run unattended.

## What Release A does and does not do
- Adds 12 nullable columns, 3 indexes, 2 FKs (`ON DELETE SET NULL`) on `Visit` (schema gate: additive only).
- Backfill fills ONLY null columns on Visits that a ScheduleEntry already mirrors, and INSERTS new Visits (marked `backfilledAt`, no transcript) for patient-matched entries with no Visit. Free-text entries (no patient) stay in ScheduleEntry.
- Never writes a transcript, status or patient on an existing Visit. Never touches ScheduleEntry, Patient, VisitDocument, RecordingInbox, Encounter.
- The shipped code hides inserted Visits from every Visit list (`LIVE_VISITS`) until Release B, so users see no change. **Therefore the backfill must only run when the LIVE revision already contains Release A** (gate `code`). Release A must be in the promote that runs first; its columns are applied by the promote's own additive schema gate.

## Scripts (all in `SaaS app/scripts`, all refuse production without `--allow-prod` + `PROD_CONFIRM=WRITE-TO-PRODUCTION-<host>`; read-only ones need neither)
| Script | Purpose |
|---|---|
| `unify-dryrun.ts` | counts, fingerprint, plan counts (read-only; `--scratch-copy` + `SCRATCH_CONFIRM` for the restored copy) |
| `unify-fingerprint.ts` | hash of every Visit id + stored transcript and of RecordingInbox; `--against-snapshot YYYYMMDD` |
| `unify-snapshot.ts` | named tables `_snap_YYYYMMDD_{visit,scheduleentry,inbox,meta}` with per-row hashes; never overwrites; keep 7+ days |
| `unify-backfill.ts` | dry run by default; `--apply`; production needs `--expect-inserts N` from the dry run; one transaction; idempotent |
| `unify-verify.ts` | post-run gates (counts, fingerprint, snapshot row diff) |
| `unify-copyback.ts` | copy back ONLY rows whose hash differs from the snapshot |
| `unify-rollback.ts` | deletes only unused migration-inserted Visits, nulls filled columns |
| `unify-recording-check.ts` | recording gate: no recording activity in 15 min |
| `unify-rehearse.ts` | full Release A on a scratch copy; refuses production and staging |
| `unify-seed-fake.ts` | FAKE rows for rehearsal/staging; refuses production |
| `release-a-run.sh` | runs all gates in order as Cloud Run job steps, stops at the first red gate |

## Run (Production agent)
Order is fixed: promote, verify (safeguard 8.3), then this. Preconditions you must have yourself: Sohail's approval typed in YOUR session; promote gate green tonight; verified on-demand backup restored to a scratch database with matching counts.
```bash
cd "SaaS app"
SOHAIL_APPROVAL_TYPED=yes PROMOTE_VERIFIED=yes RELEASE_A_COMMIT=<commit containing Release A> \
BACKUP_ID=<id> SCRATCH_SECRET=<secret holding the scratch DATABASE_URL> SCRATCH_HOST=<scratch db host> \
scripts/release-a-run.sh --env production
```
Add `--print-only` first to read every command. Do not set `SOHAIL_APPROVAL_TYPED` unless you saw the approval typed in your own session. Any `STOP` line means stop: write the morning report, do nothing else on production.

Gates, in the order the script runs them (any FAIL stops the run):
1. code: live revision contains Release A (git ancestor check). 2. recording: quiet for 15 min (recordings paused). 3. backup: production counts equal the restored scratch copy (patients, visits, visits with transcript, documents, inbox). 4. rehearsal: full Release A on the scratch copy, zero change to transcripts/ScheduleEntry/Patient/VisitDocument/RecordingInbox/Encounter and identical fingerprint, idempotent second run, rollback restores the start state. 5. snapshot taken. 6. schema (no-op if the promote applied it; additive gate). 7. dry run, then backfill with `--expect-inserts`. 8. post-run: counts, fingerprint, snapshot diff (one copy-back of differing rows allowed; a second failure or a failed copy-back = restore from the verified backup is Sohail's morning decision).

## Expected after a clean run
Visit grows by exactly `toInsert`; every other table count equal; `visitWithTranscript` equal; fingerprint equal; ScheduleEntry snapshot diff 0/0/0; Visit snapshot diff changed=0, missing=0, added=toInsert.

## Rollback
`unify-rollback.ts --allow-prod` (with `PROD_CONFIRM`): removes only inserted Visits that still have no transcript, documents, inbox link or consent row and nulls the filled columns. The columns stay (dropping them needs Sohail). Code rollback = shift traffic to the previous revision (columns are nullable and unused by it, but note the previous revision would then list inserted Visits: roll back the data first).

## Morning report (schedule-billing-progress.md)
Each gate pass/fail with time, counts before and after, hash matched yes/no, anything copied back, release numbers shipped, the one decision needed. No names, transcripts or commit hashes.
