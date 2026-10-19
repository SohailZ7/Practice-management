# Practice Management

Web app for the practice: **Access** (Google sign-in + per-module permissions), **Schedule**, **Tasks**, **Employees**, **Billing**, **Ledger**.
Requirements: the latest file in [specs/](specs/) (currently [requirements-v19.md](specs/requirements-v19.md)); older versions are kept.
Each user can choose Light, Dark or System under **Settings**.

Stack: Next.js 14 (App Router, TypeScript), Prisma + PostgreSQL, Auth.js (NextAuth v4) with Google, exceljs for imports.

## Run locally

1. Start Postgres (Docker Desktop must be running):
   ```bash
   docker compose up -d
   ```
2. Create a Google OAuth client (below) and fill in `.env`:
   ```bash
   cp .env.example .env
   openssl rand -base64 32   # paste as NEXTAUTH_SECRET
   npm run phi:generate-key  # paste as PHI_ENCRYPTION_KEY (field-level encryption; required in production)
   ```
3. Install, create tables, seed, run:
   ```bash
   npm install
   npm run setup
   npm run dev
   ```
   Open http://localhost:3000. `npm run setup` seeds Sohail (Admin), Dr Khalid, Razak Ahmed and Muntaha,
   the default tracks/entry types, and a "B & BC" task category. It also installs the append-only audit-log
   triggers (`npm run db:harden`).

### Google OAuth client
Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
- Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` (and
  `https://<your-cloud-run-url>/api/auth/callback/google` for production).
- Put the client ID/secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Only emails listed under **Access** can sign in; everyone else is denied.

## Importing the schedule from Excel
Schedule → Import. Upload an `.xlsx` shaped like the Outpatient Board, pick the sheet (e.g. `Doc& HP 8.10-8.22`),
review the preview (new / duplicate / skipped counts, provider matching), then confirm. Re-importing the same sheet
adds nothing twice. Nothing is imported until you do this; real workbooks are git-ignored.

## Billing
Modeled on `bandbc-billing-app`. Providers (anyone with edit access to Billing) record encounters: patient, optional MRN,
date, program, ICD-10 codes, charge code or note. The Admin marks each encounter "Entered into GetIX" (needs an MRN; this
locks it), manages programs, adds or fixes MRNs, merges duplicate records, restores deleted encounters and views edit
history. Nothing is erased. Use made-up patients locally; see the BAA/hosting note in the spec before real patient data.

## Ledger
Business cash in / cash out, shaped like the practice's ledger spreadsheet: Date, Cash In, Cash Out, Transaction By,
Category, Method, Comments. Edit in the grid, filter, see totals, view a Summary by category and month, export CSV.
Categories, methods and names are editable under Ledger → Lists. Only the Admin has Ledger access until granted.

## Syncing B & BC from the Todo App
On your own task list, **Sync "B & BC" from Todo App** copies that category from the Todo App (one-way: the Todo App is the
master). Locally it signs in as your `gcloud` account (`gcloud auth login`); on Cloud Run give the service account
**Cloud Datastore Viewer** on the Todo App's project (`sohail-todo-app`). Settings: `TODO_APP_PROJECT_ID`,
`TODO_SYNC_CATEGORY`, `TODO_APP_ACCESS_TOKEN` (optional override).

## Tests and checks
```bash
npm test          # access rules, importer (synthetic data only), helpers
npm run typecheck
npm run build
npm run verify:recurring   # end-to-end recurring-task check against the database (synthetic data)
```

## Deploy to Google Cloud Run (recommended)
Cloud Run's disk is temporary, so use **Cloud SQL for PostgreSQL** (not SQLite).

1. Create a Cloud SQL Postgres instance and database; store `DATABASE_URL`, `NEXTAUTH_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in Secret Manager.
2. Create the tables once (from your machine via the Cloud SQL Auth Proxy): `npx prisma db push && npm run db:seed`.
3. Deploy:
   ```bash
   gcloud run deploy practice-management --source . --region us-central1 \
     --add-cloudsql-instances <PROJECT:REGION:INSTANCE> \
     --set-secrets DATABASE_URL=DATABASE_URL:latest,NEXTAUTH_SECRET=NEXTAUTH_SECRET:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest \
     --set-env-vars NEXTAUTH_URL=https://<your-cloud-run-url> \
     --allow-unauthenticated
   ```
   `--allow-unauthenticated` is intended: the app does its own Google sign-in and allowlist.
   Use the Cloud SQL socket form of `DATABASE_URL` (`?host=/cloudsql/<instance>`).
4. Add the production redirect URI to the Google OAuth client.

Uploads are limited to 30 MB by the app (Cloud Run's request limit is 32 MB).

## Notes
- Client names and Zoom passwords are sensitive. The app requires sign-in everywhere and only shows NPI/Zoom
  details to people with edit access to Schedule. HIPAA obligations are an open question in the spec.
- Task changes by other people show on page refresh (no live sync).

## Security and HIPAA

The app holds patient information, so it implements technical safeguards: automatic logoff (15 min idle, 12 h
maximum), an audit log of every PHI access that is append-only in the database, security headers and a strict
Content-Security-Policy, rate limits, field-level AES-256-GCM encryption of the most sensitive free-text fields, a guard
against patient details in Tasks, and an Admin access review (**Access, then Access review**).

Software cannot make an organization HIPAA compliant. What the app does, and everything that is still the
organization's job (Google Cloud BAA, Cloud SQL setup, two-step verification, policies, training, risk assessment,
retention), is in [docs/hipaa-readiness.md](docs/hipaa-readiness.md). It is not legal advice.

Useful commands: `npm run db:harden` (audit-log triggers, repeatable), `npm run db:encrypt-phi -- --database <name>`
(encrypt existing rows), `npm run verify:audit`, `npm run verify:phi -- --database <scratch db>`.
