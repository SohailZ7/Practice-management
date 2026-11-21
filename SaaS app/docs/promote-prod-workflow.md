# Production promote workflow (draft, not active)
Files: `.github/workflows/promote-prod.yml` (the button) and `SaaS app/scripts/promote.sh` (the steps; also runnable by hand).

Order, stops at the first failure: HOLD file -> commit is on main -> staging serves this exact commit -> build prod image -> schema gate dry run (additive only)
-> [dry run stops here] -> on-demand Cloud SQL backup -> apply additive schema, then re-run the gate: must say "no schema changes" (every column exists) -> deploy
with no traffic -> smoke (login 200, CSP header, anonymous API 401) -> traffic -> 2 minute 5xx count, automatic rollback above 5.

Not yet verified: nothing here has been run against production. Needs (Sohail): GitHub Environment "production" with him as reviewer; prod deploy identity and
Workload Identity provider in project bbc-practice-mgmt (values replace the TODO lines); then two dry runs (dry_run=true) before a real one.
Release numbering, Tested/Released feedback moves and the Desktop release stay outside this workflow for now.
