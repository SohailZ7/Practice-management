# Screen regression tests

Catches a page that silently breaks layout or behavior (the 2026-11 Ledger incident: uneven row heights, a row stuck in inline edit, inner scrollbar).

**Run:** `docker compose up -d db` then `npm run test:screens` (dev server) or `E2E_PROD=1 npm run test:screens` (production build; what the gate uses). Needs Google Chrome installed. It creates and fills a throwaway local database `practice_regress` (synthetic data only, refuses any other database) and signs in with a minted session cookie for `e2e-admin@bbc.invalid`. Never touches staging or production data.

**What it checks, per page, at 1440 and 390 px:** loads (status < 400, not redirected), expected seeded text present, no horizontal overflow, no console/page errors or 5xx, no blank rows, no collapsed rows, no row more than ~4x the median height, no inline date/select fields showing in table rows by default.

**Pages covered:** every `page.tsx` under `src/app`: see `e2e/screens.ts` (Overview, Patients and chart, Schedule + providers/settings/import, Billing Encounters/new/history/Incorrect/Files/patients/programs, Reports, Tasks + analytics/recurring, Employees, Ledger + Summary + Lists, Notes, Feedback, Settings, Administration and all Admin sub-pages incl. Users, Download, Login). `tests/screenCoverage.test.ts` (part of `npm test`) fails if a page is added without being listed. Core actions: `e2e/actions.spec.ts`.

**Gate:** `scripts/staging-gate.sh` runs it last, on the exact checked-out commit, and fails the gate on any failure. Playbook section 7: no promote unless it passed on that commit.

## Post-promote production checklist (read-only, Production agent)
Sign in as an admin and open each page; confirm it renders with no broken layout, uniform rows, no error banner, no horizontal scroll; change nothing:
/ , /patients, /schedule, /billing, /billing/incorrect, /billing/files, /reports, /tasks, /employees, /ledger, /ledger/summary, /ledger/settings, /notes, /feedback, /settings, /admin, /admin/access. Then check `gcloud run services describe practice-mgmt` revision matches and Cloud Run logs show no status>=500 since the promote.
