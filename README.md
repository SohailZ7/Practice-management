# Practice Management

Web app for the practice: **Access** (Google sign-in + per-module permissions), **Schedule**, **Tasks**, **Employees**, **Billing**.
Requirements: the latest file in [specs/](specs/) (currently [requirements-v4.md](specs/requirements-v4.md)); older versions are kept.
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
   ```
3. Install, create tables, seed, run:
   ```bash
   npm install
   npm run setup
   npm run dev
   ```
   Open http://localhost:3000. `npm run setup` seeds Sohail (Admin), Dr Khalid, Razak Ahmed and Muntaha,
   the default tracks/entry types, and a "B & BC" task category.

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

## Tests and checks
```bash
npm test          # access rules, importer (synthetic data only), helpers
npm run typecheck
npm run build
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
