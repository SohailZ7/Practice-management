# Practice Management: project context (handoff for a fresh session)

Written 2026-10-19 so a new session can continue without the old conversation. **Verify against reality first** (`git status`, `git log`, `docker ps`): other Claude sessions also work in this repo (notably the Desktop App one), so facts here can age.

## 1. What this is
A web app ("the SaaS app") for the Brain & Behavior Center, an outpatient behavioral-health practice in Washington State, owned by **Sohail** (Admin, `sohail30@gmail.com`). It will hold PHI (patient names + mental-health info), so HIPAA is a design constraint. A Mac **Desktop App** is being designed separately (`../Desktop App/`).

## 2. Repo layout and git state
- Repo root `/Users/szafar/Documents/GitHub/Practice-management` (GitHub `SohailZ7/Practice-management`, branch `main` only). Contains `SaaS app/` (the web app), `Desktop App/` (desktop requirements/architecture, owned by another session), `Templates/` (psychiatric note templates, `.docx`), and a root `README.md`.
- `SaaS app/` holds everything for the web app: `src/`, `prisma/`, `specs/` (requirements v1 to v19, never edited in place), `docs/` (`hipaa-readiness.md`, this file), `scripts/`, `tests/`.
- Last pushed commit `dd7484e`. Five later commits from the Desktop session are local and unpushed (`26693ed`, `2e2fcba`, `1628fa6`, `5955f69`, `dd370d5`); the last two add the desktop-API schema (`DesktopSession`, patient link on schedule entries, patient consent) plus consent and token rules with tests. This file and the `AGENTS.md` pointer were written afterwards and are uncommitted. Re-check `git log` for anything newer.
- **Known spec problem:** the Desktop session edited `specs/requirements-v19.md` in place. It now describes the desktop API, patients on the schedule and AI consent, but the **31 security requirements (SEC-1 to SEC-31) and the PHI-guard rows (TSK-56, TSK-57) that v19 had after the HIPAA merge are gone** (they are in commit `3d2bba3`). The code still has all of that. Fix by restoring them into a new `requirements-v20.md` (versioning rule below).

## 3. Running it
- Work inside `SaaS app/`. Postgres: `docker compose up -d` (container `practice-management-db-1`, volume `practice-management_pgdata`; `docker-compose.yml` pins `name: practice-management` so moving folders never orphans the data). First time: `npm install`, `npm run setup`, `npm run dev` on http://localhost:3000.
- `.env` (gitignored; never print it) holds: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PHI_ENCRYPTION_KEY` (+ `_KEY_ID`, `_PREVIOUS_KEYS`), `SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS`, `TRUSTED_PROXY_HOPS`. Optional: `PRACTICE_TIMEZONE` (default America/Los_Angeles), `TODO_APP_PROJECT_ID`, `TODO_SYNC_CATEGORY`.
- The Google OAuth client lives in GCP project **`practice-mgmt-sz`** (separate from the Todo App's `sohail-todo-app`); redirect URI `http://localhost:3000/api/auth/callback/google`. The client secret was pasted into a chat once, so **recommend rotating it** before real use.
- Stop the dev server by **port** (`lsof -ti :3000 | xargs kill`), not `pkill -f "next dev"` (it kills other sessions' servers). Always `rm -rf .next` before `npm run build` and after, then restart dev.
- Checks: `npx tsc --noEmit`, `npx vitest run` (263 passing at last count), `npm run build`, `npm run verify:recurring`, `npm run verify:audit`, `npm run verify:phi -- --database <name>`.
- Backup of the local DB taken before the HIPAA schema change: `/private/tmp/claude-501/-Users-szafar-Documents-Tasks/6a7f1655-a08f-45b5-ae4c-5c6cb5d9a6d6/scratchpad/practice-backup-before-hipaa.sql` (temp folder; may be gone).

## 4. Stack
Next.js 14 App Router + TypeScript; Prisma + PostgreSQL; Auth.js (NextAuth v4) Google sign-in with an email allowlist; `exceljs`; `@dnd-kit`; Vitest. UI = server components + client components calling **server actions** ("use server" files may only export async functions). Visual design: navy/white theme (taken from the practice's ledger spreadsheet), light/dark/system per user, left nav (pin/unpin, drag edge to resize up to 1/3 screen, Admin can reorder), compact 13px type. Hosting plan: Google Cloud Run + Cloud SQL; **not deployed yet**.

## 5. Modules (per-module access: none / view / edit; Admin has all)
- **Access**: Google-only sign-in, allowlist, roles ADMIN/PROVIDER/STAFF, audit log, per-user task-view grants, Access Review page (`/admin/access-review`) with CSV exports, last sign-in, 90-day flags.
- **Schedule**: Excel-like grid (Day/Week/Month), provider dropdown (Dr. Khalid Ahmed, Dr. Lucy), Psych Eval and Track sections, status flags, configurable tracks/types, **Excel import** of the "Outpatient Board" workbook (sheet "Doc& HP 8.10-8.22"; preview, provider matching, idempotent). The real workbook contains PHI: never copy it into the repo.
- **Tasks**: sections **Past due** (always shown, red, flag icon) / **Today** (due today or sun flag) / **Backlog** / **Completed** / **Expired**; click-to-edit, due date, expiration date, notes popup, links, category labels, completed date, Analytics (per board and team-wide `/tasks/analytics`), **recurring tasks** (daily = weekdays only; weekly; monthly; end date or never; generated on their specific day, reconciled on every edit), per-employee tabs (Admin's own first), drag-and-drop **Admin only**, non-admins see only their own tasks plus read-only grants (Razak and Muntaha can view each other), one-way **sync from the Todo App's "B & BC"** (button on the Admin's own board; Todo App is master; never run against live data yet).
- **Employees**: directory; "Give login" for an employee with an email.
- **Billing** (modeled on `bandbc-billing-app`): encounters (patient, optional MRN, date, program, ICD-10, charge code/note), Admin marks "Entered into GetIX" (locks), soft delete, edit history, MRN add/merge, audit.
- **Ledger**: business cash in/out grid, categories/methods/people lists, summary, CSV export. Admin only by default.

## 6. People and access (seeded)
Sohail (Admin, Administrator); Dr Khalid (Provider/Doctor, provider "Dr. Khalid Ahmed"); Razak Ahmed and Muntaha (Office Managers; Schedule edit, Tasks edit, Billing edit, Employees view); Dr Lucy and Dr Irfan (doctors, **no login yet; waiting on their Google emails**, then use Employees → Give login). New logins default to Schedule edit, Tasks edit, Employees view, no Billing/Ledger.

## 7. Rules and decisions that must hold
- **Requirements are versioned**: each time the owner gives new requirements, copy the latest `specs/requirements-vN.md` to `vN+1` with a "Changes since vN" section; never edit old versions (see `AGENTS.md`).
- Dates are `YYYY-MM-DD` strings; "today" is computed in the practice time zone on the server for everybody.
- Permissions are enforced on the server for every page, action and route. Non-admins can only change their own tasks.
- Daily recurring = Monday to Friday. Recurring tasks appear on their specific day; editing a recurring task removes open generated tasks the new rule no longer produces (finished ones stay).
- Past due is shown to everyone; Expired tasks leave the queue and are restorable.
- HIPAA: software alone is not "HIPAA compliant". Implemented in app: 15-min idle / 12-h session limits (server-enforced), audit of PHI access with ids/counts only, append-only audit tables (DB triggers via `npm run db:harden`), CSP/security headers/no-store/rate limits/CSRF checks, AES-256-GCM field encryption (client info, Zoom passwords, task notes, import drafts; keyed-hash dedupe), PHI guard on task text, access review. Billing names/MRNs and the Ledger are not field-encrypted. Organization to do (see `docs/hipaa-readiness.md`): BAA with Google Cloud and covered services only, Cloud SQL private/encrypted/backups, IAP or Cloud Armor, Secret Manager for the key, 2-step verification (prefer Workspace), risk assessment, policies, training, incident plan, officers.

## 8. Not verified / open
1. **Real Google sign-in has never been tested in a browser after the HIPAA merge** (agents used minted cookies). Run the checklist in `docs/hipaa-readiness.md`. Everyone must sign in again after the session-format change.
2. Restore the lost SEC/TSK-56-57 requirements (section 2) into a new `requirements-v20.md`, and confirm the Desktop session's schema changes (already committed) are applied to the local database (`npx prisma db push`) and that all tests still pass.
3. Dr Lucy and Dr Irfan emails; whether they get Billing access.
4. Deployment: accept Google's BAA for `practice-mgmt-sz`, Cloud SQL, Secret Manager, IAP/Cloud Armor, `PHI_ENCRYPTION_KEY`, Cloud Run service account needs Cloud Datastore Viewer on `sohail-todo-app` for the Todo App sync. Steps for applying to a real database are in `docs/hipaa-readiness.md`.
5. Todo App sync has only been dry-run; the owner clicks the button when ready. Other categories (Studio, Integrations, Personal) are not synced.
6. Open spec questions (v19 section 10): Ledger import, running balance, Office Managers marking GetIX, ICD-10 official-list check, etc.

## 9. Gotchas learned
- `prisma db push` asks for `--accept-data-loss` when adding unique constraints (safe when existing values are NULL).
- zsh errors on unquoted globs like `--include=*.ts`; quote them.
- Worktree isolation for agents fails when the session's cwd is not a git repo: create the worktree manually (`git worktree add`), give the agent a separate database, never `db push` the shared `practice` DB from it.
- Do not run simulated-date scripts that call `ensureRecurringTasks` without `onlyIds`: they generate tasks for real recurring tasks.
- Moving the repo folder changes the docker compose project name unless pinned (already pinned).
- `Desktop App/` and `Templates/` belong to the owner and the Desktop session; leave them alone.

## 10. How the owner likes to work
Short, honest status; check things yourself rather than trusting an agent's report; ask when a decision is theirs. Commit only when asked ("Commit everything to main (no push)"); push only when asked. They often reply to a question box with a new message instead, so read the actual message.
