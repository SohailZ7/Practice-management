# Prompt for a new session: build the desktop version

Copy everything below the line into a new Claude Code session opened in a new, empty folder for the desktop app (or in a sibling folder of the web app).

---

You are helping me (Sohail, the Admin/owner) build a **desktop version** of an existing web app, "Practice Management". Before writing any code, read the web app's repo and specs, then propose an approach and wait for my OK.

## The web app (the "SaaS app")
- Repo: `/Users/szafar/Documents/GitHub/Practice-management` (GitHub: SohailZ7/Practice-management). The web app lives in the **`SaaS app/`** subfolder (the repo root is a container that will also hold the desktop app). Inside `SaaS app/`, read `README.md`, `AGENTS.md`, and the **latest file in `specs/`** (`requirements-v18.md` at the time of writing; older versions are kept on purpose). The specs are the source of truth for behavior; `docs/hipaa-readiness.md` may exist once the HIPAA branch is merged.
- Purpose: runs an outpatient behavioral-health practice (Brain & Behavior Center, Washington State). It will hold **PHI** (patient names + mental-health info), so treat HIPAA as a design constraint, not an afterthought (see "Rules" below).
- Stack: Next.js 14 (App Router, TypeScript), Prisma + PostgreSQL, Auth.js (NextAuth v4) with **Google sign-in** (allowlist of emails), `exceljs` for Excel import, `@dnd-kit` for drag and drop, Vitest. UI is server components plus client components using server actions (there is **no public REST API** today, only one CSV export route and the Excel import API routes).
- Hosting plan: Google Cloud Run + Cloud SQL (Postgres) in the GCP project `practice-mgmt-sz`; not deployed yet. Local dev: `docker compose up -d` (Postgres), `npm run setup`, `npm run dev` on http://localhost:3000. Secrets live in a gitignored `.env`; never print or commit them.
- Quality gates in the web repo: `npx tsc --noEmit`, `npx vitest run` (~120 tests), `npm run build`, `npm run verify:recurring`.

## Modules (all behind per-module access: none / view / edit; Admin has everything)
1. **Access**: Google-only sign-in, admin-managed allowlist, roles ADMIN / PROVIDER / STAFF, per-module levels, audit log, per-user theme (light/dark/system), read-only grants so one person can view another's tasks.
2. **Schedule**: Excel-like grid (day / week / month), provider dropdown (Dr. Khalid Ahmed, Dr. Lucy, ...), Psych Eval and Track entries, status flags (absent, canceled, completed, missed), **Excel import** that understands the practice's "Outpatient Board" workbook layout (preview, provider matching, idempotent re-import).
3. **Tasks**: sections Past due / Today / Backlog / Completed / Expired; click-to-edit rows, due date, expiration date, notes popup, links, categories, drag-and-drop ordering (Admin only); **recurring tasks** (daily = weekdays only, weekly, monthly, with end date or never); per-employee tabs for the Admin; non-admins see only their own tasks plus read-only grants; analytics (per board and team-wide); one-way sync of the "B & BC" category from the separate Sohail Todo App.
4. **Employees**: directory, "give login" for an employee with an email.
5. **Billing** (modeled on the repo `bandbc-billing-app`): providers record encounters (patient, optional MRN, date, program, ICD-10 codes, charge code or note); the Admin marks encounters "Entered into GetIX" (locks them); soft delete, edit history, MRN add/merge, audit.
6. **Ledger**: business cash in / cash out grid, categories, methods, summary, CSV export.

## Conventions and rules I expect you to follow
- **Requirements are versioned.** Every time I give new requirements, create the next `specs/requirements-vN.md` as a full current copy with a "Changes since vN-1" section; never edit an old version. Do this in the desktop app's own `specs/` folder too, and link to the web app's spec where behavior is shared.
- Dates are `YYYY-MM-DD` strings; "today" is computed in the **practice time zone** (America/Los_Angeles), never the device's.
- Permissions are enforced **on the server**, never only in the UI. Anything the desktop app does must go through the same rules (module levels, task visibility, Admin-only actions).
- **PHI discipline:** no patient names or MRNs in logs, URLs, analytics, crash reports or temp files; encrypt anything cached or stored on disk; auto-lock after idle; sign-out clears local data. A signed Business Associate Agreement and Google Cloud's covered services are assumed for the hosted side.
- Be honest about compliance: software alone does not make an organization HIPAA compliant.
- Use only synthetic data in tests and examples. Don't push or commit unless I ask. Ask me when a decision is mine to make; otherwise pick a sensible default and say so.

## What I want the desktop app to add
(Fill this in before sending, or tell the new session in your first message.)
- <e.g. offline mode / local file import / printing / background sync / system tray reminders / local backups / device integrations>

## What I need from you first
1. Read the repo and specs and give me a short summary of what you understood (in your own words).
2. Compare 2 or 3 architectures and recommend one with trade-offs, for example: (a) a thin Electron/Tauri shell that loads the hosted web app plus native features; (b) a shell plus a new authenticated API layer on the web app so the desktop client can work offline and sync; (c) something else you suggest. Cover sign-in (Google OAuth in a desktop app), where PHI would live on the device and how it is encrypted, update/distribution, and how much of the web UI code can be shared.
3. List the open questions you need answered.
4. Only after I approve, write `specs/requirements-v1.md` for the desktop app and build in small, tested steps.
