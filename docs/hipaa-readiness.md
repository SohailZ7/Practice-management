# HIPAA readiness: technical safeguards and what is left for the organization

**Read this first.** Software cannot make an organization "HIPAA compliant". Compliance is about how the practice
behaves: its policies, training, contracts, devices, people and decisions. This document lists the technical safeguards the
app implements for the Security Rule (45 CFR 164.312), where to find them in the code, and everything that is still
**ORGANIZATION TO DO**. It is engineering documentation, **not legal advice**. Have a qualified health-privacy attorney or
compliance consultant review the practice's obligations, especially Washington State law and 42 CFR Part 2 (below).

The app holds patient names, appointment details and mental-health information for an outpatient behavioral-health
practice in Washington State. Treat everything in it as protected health information (PHI).

## 1. Technical safeguards, control by control

| Standard (45 CFR) | Spec | What the app does | Where | Left for the organization |
|---|---|---|---|---|
| 164.312(a)(1) Access control | Unique user identification (R) | Each person signs in with their own Google account; only active users on the Admin's allowlist get in; no shared logins. Every audit entry names the user. | `src/lib/auth.ts`, `src/lib/session.ts` | Never share a login. Name a person to approve access. |
| | Emergency access procedure (R) | Several Admins can exist; the last active Admin cannot be removed. | `src/lib/access.ts` (`wouldRemoveLastAdmin`) | **ORGANIZATION TO DO:** write a break-glass procedure (who can reach the data, and how, if the Admin and the app are unavailable), including database and key access. |
| | Automatic logoff (A) | Idle limit 15 min (`SESSION_IDLE_MINUTES`) and absolute limit 12 h (`SESSION_MAX_HOURS`) enforced on the server from stamps inside the encrypted session cookie. Only real requests refresh the idle clock (not prefetches or timers). Browser warns 2 minutes before. | `src/lib/sessionExpiry.ts`, `src/middleware.ts`, `src/lib/session.ts`, `src/components/IdleLogoff.tsx` | Also set a screen-lock timeout on every workstation. |
| | Encryption and decryption (A) | AES-256-GCM field-level encryption of `ScheduleEntry.clientInfo`, `Provider.zoomPassword`, `Task.notes`, `ImportDraft.payload`; dedupe keys use a keyed HMAC so no client text is left in the database. Everything else relies on Cloud SQL encryption at rest. | `src/lib/crypto/*`, `src/lib/db.ts`, `scripts/encrypt-phi.ts` | Enable and verify Cloud SQL encryption (default) or CMEK; protect `PHI_ENCRYPTION_KEY` (section 4). |
| | Per-module authorization | Access is none / view / edit per module, checked on the server for every page, action and API route. Billing providers only change their own encounters. Failed attempts are audited. | `src/lib/access.ts`, `src/lib/session.ts` (`requireAccess`), `src/lib/billing/rules.ts` | Review access quarterly (section 3). Apply minimum necessary: grant Billing only to people who need it. |
| 164.312(b) Audit controls | Record and examine activity (R) | Audit entries for: sign-in, denied sign-in, sign-out; every Schedule page load (date range and provider id, never client names); Providers page; entry create/update/delete; Excel import upload, preview and commit; CSV exports; Billing lists, searches, patient and encounter views, edits and history views; user and access changes; denied access. Details hold ids and counts only. The table is append-only in the database. Admins can filter, page and export the log. | `src/lib/audit.ts`, `prisma/sql/audit-append-only.sql`, `src/app/admin/access-review/` | **ORGANIZATION TO DO:** actually review the log (at least quarterly, and after any incident); keep it six years (section 2); turn on Google Cloud data-access audit logs for Cloud SQL, Secret Manager and KMS. |
| 164.312(c)(1) Integrity | Authenticate ePHI (A) | GCM authentication tags detect any change to an encrypted value. `BillingHistory` keeps the prior version of every Billing change and is append-only. Encounters locked in GetIX cannot be edited. | `src/lib/crypto/phi.ts`, `src/lib/billing/history.ts` | Tested restores and Cloud SQL point-in-time recovery for everything else. |
| 164.312(d) Person or entity authentication | (R) | Google OAuth sign-in (no local passwords); Google must report a verified email; the email must be on the allowlist and active; the user is re-read from the database on every request, so deactivation is immediate. | `src/lib/auth.ts` | **ORGANIZATION TO DO:** enforce two-step verification on every staff Google account (prefer Google Workspace with enforced 2SV, not personal Gmail). The app cannot check this. |
| 164.312(e)(1) Transmission security | Integrity controls (A) and encryption (A) | Production cookies are `Secure`, `HttpOnly`, `SameSite=Lax`; HSTS (production); strict Content-Security-Policy with a per-request nonce and no third-party origins; `X-Content-Type-Options`, frame denial, `Referrer-Policy: no-referrer`, `Permissions-Policy`; `Cache-Control: no-store` on every response; same-origin (CSRF) checks on the import and keep-alive API routes; rate limits on sign-in, import, export and server actions. | `next.config.mjs`, `src/middleware.ts`, `src/lib/security/*` | Serve only over HTTPS (Cloud Run does; use a managed certificate on a custom domain). Put Cloud Armor or Identity-Aware Proxy in front (section 4). |

### Related administrative, physical and organizational items (45 CFR 164.308, .310, .314, .316)

| Item | What the app does | Left for the organization |
|---|---|---|
| Risk analysis and risk management (308(a)(1)) | Nothing. | **ORGANIZATION TO DO:** a written, dated risk assessment covering this app, Google Workspace, devices and paper; a risk-management plan; repeat at least yearly and after major changes. |
| Sanction policy (308(a)(1)) | Audit log supports investigation. | **ORGANIZATION TO DO:** written sanctions for misuse. |
| Information system activity review (308(a)(1)(ii)(D)) | Access review page and audit-log viewer (`/admin/access-review`). | **ORGANIZATION TO DO:** schedule and document the reviews. |
| Security and privacy officers (308(a)(2)) | Nothing. | **ORGANIZATION TO DO:** name a Security Officer and a Privacy Officer in writing. |
| Workforce security, authorization, termination (308(a)(3)) | Admin adds, deactivates and reactivates users; deactivation takes effect on the next request. | **ORGANIZATION TO DO:** a procedure that removes access the day someone leaves, and a check at each quarterly review. |
| Information access management (308(a)(4)) | Per-module levels; read-only task sharing by Admin grant. | **ORGANIZATION TO DO:** written rules for who gets which level. |
| Security awareness and training, log-in monitoring, password management (308(a)(5)) | Denied sign-ins are audited. Passwords are Google's. | **ORGANIZATION TO DO:** train every workforce member (on hire and yearly), including the warnings about not putting patient details into Tasks. |
| Incident procedures (308(a)(6)) and breach notification (164.400-414) | Audit log and append-only history support investigation. | **ORGANIZATION TO DO:** an incident-response plan, who to call, how to preserve logs, and a breach-notification procedure (individuals, HHS, and in some cases media; check Washington's own notice rules). |
| Contingency plan: backups, disaster recovery, emergency mode (308(a)(7)) | Data is in Postgres; field encryption keys are separate from the database. | **ORGANIZATION TO DO:** automated Cloud SQL backups with point-in-time recovery, a **tested restore**, and a copy of `PHI_ENCRYPTION_KEY` stored apart from the database (without it, encrypted fields are unrecoverable). |
| Periodic evaluation (308(a)(8)) | Tests and verification scripts (section 5). | **ORGANIZATION TO DO:** re-evaluate when the app or environment changes. |
| Business associate agreements (308(b), 314) | Nothing. | **ORGANIZATION TO DO:** a signed BAA with Google Cloud (and Google Workspace if used) and use only services the BAA covers (see section 4). Do not send PHI to services without a BAA. |
| Facility, workstation and device controls (310) | `Cache-Control: no-store` limits what the browser keeps. | **ORGANIZATION TO DO:** full-disk encryption and screen locks on every device, no PHI on personal devices without controls, disposal and re-use procedures. |
| Documentation and retention (316) | Audit log is append-only; no automatic purge exists. | **ORGANIZATION TO DO:** keep policies and logs **six years**; see section 2. |
| Privacy Rule items (Notice of Privacy Practices, patient rights, minimum necessary) | Out of scope for this software. | **ORGANIZATION TO DO.** |

## 2. Retention of audit logs (six years)

HIPAA requires documentation to be kept six years. The `AuditLog` and `BillingHistory` tables are append-only at the
database level and the app has no deletion job, so nothing removes them. Keep them in Cloud SQL, keep backups at least as
long as your policy requires, and consider exporting the log (the **Export** button on `/admin/access-review`) to
write-once storage (a Cloud Storage bucket with a retention lock) each year.

## 3. Routine: quarterly access review

Once a quarter, the Admin opens **Access, then Access review** and:

1. Confirms every active person still works for the practice and still needs their level of access.
2. Looks at the **admin count** (keep it as small as the practice can manage; two is typical so one can cover for the other) and at anyone flagged **no sign-in in 90 days**.
3. Deactivates or reduces what is not needed. Exports the user CSV and keeps it with the security records.
4. Reads the audit log for unusual hours, many exports, repeated `access.denied` or `signin.denied`, or `task.phi_blocked` entries. Exports it for the records.
5. Writes down the date and who did the review.

## 4. Non-code checklist (Google Cloud and the organization)

**Contracts and scope**
- [ ] Sign the **Google Cloud BAA** (and the Google Workspace BAA if using Workspace). Use only products the BAA covers (Cloud Run, Cloud SQL, Secret Manager, Cloud KMS, Cloud Logging, Cloud Storage and Cloud Armor are generally listed; confirm against Google's current "HIPAA Included Functionality" list). Do not add analytics, error-tracking or email services that receive PHI without a BAA.
- [ ] Use a **dedicated Google Cloud project** for the practice, with billing alerts and least-privilege IAM (no `Owner` for daily use; named people only).

**Database (Cloud SQL for PostgreSQL)**
- [ ] **Private IP only** (no public IP); Cloud Run connects through a VPC connector or the Cloud SQL connector. Require SSL.
- [ ] Encryption at rest is on by default; consider customer-managed keys (CMEK) in Cloud KMS.
- [ ] **Automated backups, point-in-time recovery**, and a **restore you have actually tested** (restore to a new instance, sign in, check data). Record the date.
- [ ] Run the app as a **limited database role** (SELECT, INSERT, UPDATE, DELETE on tables; **no** TRUNCATE and, on `AuditLog` and `BillingHistory`, only SELECT and INSERT). Keep the owner role for migrations only. The append-only triggers stop accidents and a compromised app; the database owner could still disable them.
- [ ] Turn on **Cloud Audit Logs, Data Access** for Cloud SQL, Secret Manager and KMS; set a log retention that meets the six-year policy.

**Network and application edge**
- [ ] Put **Identity-Aware Proxy** (or at least **Cloud Armor** with rate limiting and an allow-list of the practice's addresses, if practical) in front of Cloud Run. The app's in-memory rate limiter is per instance: with several Cloud Run instances each counts separately and a restart resets it (`src/lib/security/rateLimit.ts`). Cloud Armor or a shared store (Memorystore/Redis) gives a hard limit. If IAP is added, the app's own sign-in still decides per-module access.
- [ ] Set `TRUSTED_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For` (Cloud Run alone: 1; behind an external load balancer: 2) so the rate limiter sees the real client address.
- [ ] Use a custom domain with a managed TLS certificate; HSTS is sent in production.
- [ ] Set Cloud Run `min-instances` and resource limits; restrict who can deploy.

**Secrets and keys**
- [ ] Store `PHI_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET` and `DATABASE_URL` in **Secret Manager** (mounted as environment variables), with access limited to the Cloud Run service account and named admins. Consider wrapping/escrowing the PHI key in **Cloud KMS**.
- [ ] Keep an offline, access-controlled copy of the PHI key (two people, sealed). **Losing it makes encrypted fields unreadable, including in backups.**
- [ ] Rotate the key on a schedule and whenever someone with access leaves (section 6).

**People and devices**
- [ ] **Two-step verification enforced** for every staff Google account; prefer a Google Workspace domain with enforced 2SV and managed devices over personal Gmail. Disable "less secure" sign-in methods.
- [ ] **Device encryption** (FileVault/BitLocker), screen locks, automatic updates, malware protection, and no PHI downloaded to personal devices.
- [ ] Written **risk assessment**, security and privacy **policies**, **training** records, an **incident-response and breach-notification plan**, and **named Privacy Officer and Security Officer**.
- [ ] Decide what may be typed into free-text fields. The Tasks page warns staff and blocks obvious identifiers, but it cannot recognise every name or diagnosis. Staff must use Billing or Schedule for patient information.

## 5. Washington State and 42 CFR Part 2

HIPAA is a minimum. **Washington's Uniform Health Care Information Act (RCW 70.02), including its provisions for
mental-health treatment records, and other state rules may be stricter** than HIPAA about disclosure, patient access and
consent. If any part of the practice is a federally assisted **substance use disorder program, 42 CFR Part 2** adds
consent and redisclosure restrictions that do not match HIPAA's. Also check Washington's breach-notification and
consumer-health-data laws. Ask counsel which apply and what they require; this document does not answer that.

## 6. Operating notes for the owner

### Keys and rotation
- `PHI_ENCRYPTION_KEY` is base64 of 32 random bytes (`npm run phi:generate-key`). Every encrypted value carries a key id (`PHI_ENCRYPTION_KEY_ID`, default `k1`), a random IV and an authentication tag.
- **Rotate:** generate a new key; set `PHI_ENCRYPTION_KEY=<new>`, `PHI_ENCRYPTION_KEY_ID=k2`, and `PHI_ENCRYPTION_PREVIOUS_KEYS=k1:<old>`; redeploy; run `npm run db:encrypt-phi -- --database <name> --rekey` (re-encrypts with the new key and recomputes dedupe keys); verify; only then remove the old key from `PHI_ENCRYPTION_PREVIOUS_KEYS`. Do not import schedules between redeploy and re-key (re-import would not recognise old rows until they are re-keyed).
- **Rollback:** `npm run db:encrypt-phi -- --database <name> --decrypt` writes plaintext and the old-format dedupe keys back (use only if you must revert to the previous version of the app).
- The production server refuses to start if `PHI_ENCRYPTION_KEY` is missing or malformed.

### What is and is not encrypted by the app
| Data | Protection |
|---|---|
| Schedule `clientInfo`, provider Zoom passwords, task notes, import drafts | App-level AES-256-GCM, plus Cloud SQL encryption at rest. |
| Billing patient names, MRNs, ICD-10 codes, charge codes, encounter notes; Ledger; task titles; schedule dates/times/providers/types/flags; user names and emails; audit details | **Not** field-encrypted. Protected by Cloud SQL encryption at rest, access control, TLS and audit logging. Billing is searched by name and MRN prefix, which ciphertext cannot support. A future option is a **blind index** (a keyed hash of normalized name/MRN prefixes stored next to an encrypted value) so Billing search can keep working. |
| Backups and exports | Contain the same data as the database. CSV exports are plaintext files: handle them as PHI. |

### Known limitations
- Signing out clears the browser cookie, but an already-issued session cookie is not revoked server-side. It stops working when it idles out, reaches 12 hours, or the user is deactivated.
- Link prefetches are not seen by the middleware (a Next.js limitation); pages still authorize every request, and prefetches never extend a session.
- The Content-Security-Policy allows inline style *attributes* (the UI uses them); it allows no inline or third-party scripts.
- The audit-log protection is a database trigger. A database owner can still disable it; use separate roles (section 4).
- Rate limiting is per instance (section 4).
- Task titles are not encrypted; the PHI guard is a heuristic.
- The imported workbook is processed in memory and not stored; the parsed draft is encrypted, deleted when committed, and purged after one hour.

### Putting the hardening on the real database (in order)
1. Take a backup (`pg_dump` or a Cloud SQL backup) and confirm it restores.
2. Generate the key and store it in Secret Manager; set `PHI_ENCRYPTION_KEY` for the app.
3. `npx prisma db push` (adds `User.lastLoginAt` and two audit-log indexes; no data is removed).
4. `npm run db:harden` (installs the append-only triggers; safe to repeat on every deploy).
5. Deploy the new version.
6. `npm run db:encrypt-phi -- --database <name> --dry-run`, then without `--dry-run`. Safe to repeat.
7. Check the app: schedule, providers, a task note, an Excel preview.
8. Walk through the browser checks in the project handover notes and run `npm run verify:audit`.

## 7. Verification commands

- `npx vitest run`: unit tests (session expiry, security helpers, crypto, PHI guard, access review).
- `npm run verify:audit`: proves `AuditLog` and `BillingHistory` reject UPDATE, DELETE and TRUNCATE (rolls back; leaves nothing behind).
- `npm run verify:phi -- --database <name>`: end-to-end encryption, import idempotency and backfill checks (writes and removes synthetic "ZZ" rows; **use a scratch database**).
- `npm run db:harden`, `npm run db:encrypt-phi`: see above.
