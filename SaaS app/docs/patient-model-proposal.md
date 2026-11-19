# Proposal: Patient as the one core object

Status: DESIGN ONLY, for Sohail's review. Revision 4: section 10 keeps one hard constraint (production data must not be corrupted); Sohail dropped the old-Desktop compatibility requirement, the Desktop is synced first. Revision 2 incorporates his answers to the open questions (section 7). No code, migration or data touched. Written from `prisma/schema.prisma` as of this branch.

## Recommendation (one option)

Keep the existing single patient record, **rename it to `Patient` in code only** (Prisma model `Patient`, `@@map("BillingPatient")`, so the table, FKs and data do not change), and link the four patient-owned things to each other with **three nullable, additive FKs on `Visit`**:

- `Visit.scheduleEntryId` (the appointment this recording was for)
- `Visit.encounterId` (the billing encounter it produced)
- `Visit.providerId` (replaces the `providerName` string; the string column stays)

Everything is additive and nullable, so it satisfies the prod rule "additive schema only". Nothing is made required on prod until a later, separate, Sohail-approved step, and only after backfill is verified.

## 1. Target model

```
Patient (BillingPatient table)   id, mrn? unique, lastName, firstName, mergedIntoId?, audit fields
  |-- ScheduleEntry*   patientId  (nullable -> stays nullable, see below)
  |-- Visit*           patientId  REQUIRED
  |     |-- VisitDocument* (+ versions)        visitId REQUIRED, cascade
  |     |-- scheduleEntryId?  -> ScheduleEntry   (NEW, nullable)
  |     |-- encounterId?      -> Encounter       (NEW, nullable)
  |     |-- providerId?       -> Provider        (NEW, nullable)
  |-- Encounter*       patientId  REQUIRED
  |-- PatientConsent*  patientId  REQUIRED
Provider  id, name unique, employeeId?  (already exists, used by ScheduleEntry)
```

Cardinality rules:
- Visit -> ScheduleEntry: many visits may point to one entry (re-record, split session), but each Visit has at most one. Index on `scheduleEntryId`.
- Visit -> Encounter: a Visit points to at most one Encounter; an Encounter can be referenced by several Visits. No unique constraint (a billing encounter is by day, a day can have more than one recording).
- Documents stay under Visit only. A document reaches the patient via Visit, the encounter via Visit.encounterId. No second parent.
- **Keep nullable permanently** for scheduleEntryId/encounterId: walk-ins, unscheduled recordings and visits not yet billed are legitimate. Only `patientId` is required, already is.
- `ScheduleEntry.patientId` stays nullable: the schedule is imported from a spreadsheet and free text (`clientInfo`) arrives before anyone matches a patient. Add a "needs patient" filter on the Schedule screen instead of forcing the column. `clientInfo`/`providerName` stay as the imported source text, not edited.
- Demographics: **add, all optional** (Sohail's decision). See section 8.

## 2. Rename BillingPatient to Patient

- Change the Prisma model name to `Patient` and add `@@map("BillingPatient")`. Relation field names that already say `patient` stay. The odd capital `Visit Visit[]` back-relation becomes `visits`.
- Zero SQL: no table rename, no data change, Prisma client types change only. The migration folder is empty or contains a comment, so the prod gate sees nothing.
- Cost: every `prisma.billingPatient.*` and `BillingPatient` type import in the SaaS app changes (mechanical; tsc finds them all). Keep `BillingHistory.entity` string value `"BillingPatient"` unchanged, since it is stored data; add a comment.
- API/JSON field names are not renamed (they already say `patient`), so Desktop and MCP are unaffected by the rename.

## 3. Backfill of existing prod rows

Principle: the backfill only **fills the new nullable columns**; it copies nothing between environments and is run only by the Production agent with Sohail's approval, after an on-demand backup, and with counts-only reporting (no PHI).

Rules, in order, each a deterministic exact match so nothing is guessed:
1. `Visit.providerId`: exact (case-insensitive, trimmed) match of `providerName` to `Provider.name`. No match: leave null.
2. `Visit.scheduleEntryId`: same `patientId` + `visitDate = ScheduleEntry.date` + provider match (via providerId, then providerName), and, if the Visit has `apptTime`, equal `timeLabel`. Link only when **exactly one** candidate exists. Zero or several: leave null.
3. `Visit.encounterId`: same `patientId` + `visitDate = encounterDate`, `deletedAt` null, **exactly one** candidate. Zero or several: leave null.
4. Unmatched rows stay null and are reported as counts (matched / no candidate / ambiguous) per rule. They are not errors. A "Link to schedule/encounter" action on the visit lets a person resolve them over time; no automatic fuzzy matching.
5. Backfill is a script that is dry-run by default (prints counts), requires an explicit flag and typed confirmation to write on prod, per the safeguards rule, and is idempotent (only fills nulls, never overwrites a manual link).

Going forward (no backfill needed): new Visits are created with those ids set where known (Desktop already selects a schedule row to record from, see section 4).

## 4. Impact

SaaS: schema (+3 columns, 3 indexes, 3 FKs with `onDelete: SetNull`), rename sweep, visit create/read include the new ids and relations, Patient page shows one timeline (schedule, visits, documents, encounters) from the relations instead of date matching, an "unlinked" indicator.

API `api/desktop/v1/*` (all additive, backward compatible; old Desktop builds keep working because every new field is optional):
- `notes/visits` POST: accept optional `scheduleEntryId`, `encounterId`, `providerId`; server validates they exist and, for entry/encounter, belong to the same patient (else 422). If `scheduleEntryId` is given and `providerId` is not, derive provider from the entry.
- `notes/visits`, `notes/visits/[id]`, `notes/visits/search`: return the three ids plus `providerName` (still the stored string; keep it populated for display and search).
- `notes/schedule`, `schedule`: no change; optionally return `visitIds` per entry so the Desktop can show "recorded".
- `recordings/check`: no change.
- `patients/[id]/consent`: no change.
- Version the change in the docs and bump release numbers per playbook (Web 1.N).

HIPAA/audit: no new PHI is introduced; linking uses ids only. Reuse `AuditLog` for link/unlink actions (who, which ids, no content), and `BillingHistory` snapshot on Visit link edits. The links must respect the shared-records rule: Notes view to read, Notes edit to link. Patient merge (`mergedIntoId`) must repoint Visit/ScheduleEntry/Encounter/Consent as today, and the cross-patient guard above keeps a merge from leaving a Visit linked to an Encounter of another patient. Deleting an Encounter is soft (`deletedAt`), so `encounterId` can point at a soft-deleted row: reads treat that as unlinked.

Risks:
- Ambiguous same-day matches (two visits one day): mitigated by link-only-if-exactly-one, leaving the rest null.
- Provider name drift ("Dr. Smith" vs "Smith, J"): some providerId stay null; the string remains authoritative for those.
- Rename sweep touches many files: pure type-level, caught by tsc/vitest; no data risk.
- Making columns required later: explicitly out of scope; needs Sohail's approval as non-additive.
- Concurrent Desktop versions writing without the ids: fine, ids are optional.

## 5. Phased plan

1. **Phase 1, rename only.** Branch off origin/main, `Patient` + `@@map`, sweep, tsc + vitest. Verify `prisma migrate diff` produces no SQL. Merge, Sohail says "push", deploy staging. Staging check: patient list, consent, billing encounters, schedule, a visit all load; table name unchanged in DB.
2. **Phase 2, additive columns + write path.** Add the three nullable FKs and indexes, `idempotencyKey`, `noScheduleEntry`, and the optional demographics columns; API accepts/returns them; Patient timeline reads relations with fallback to date matching. Staging check: new migration is additive only (gate passes); record a fake-transcript visit from a schedule row and confirm links; old Desktop build still records.
3. **Phase 3, backfill on staging.** Dry-run on staging data (counts), then write. Verify matched/ambiguous/none counts and spot-check by id only. Sohail tests, says "done".
4. **Phase 4, prod.** Production agent promotes the code and additive schema (backup first, row-count check). Then, separately, backfill dry-run on prod, Sohail approves, Production agent runs it, counts reported.
5a. **Phase 5a, Patients tab (read-only first).** Lands right after Phase 2 links exist and is verified on staging before the write features: list + search + detail with sections gated by module, audit on view, lazy transcripts, names/initials rule, timeline, needs-link badge. Staging check: user with Notes-only sees only visits/documents; billing-only sees encounters; no-access user denied; initials-only user sees no full name or demographics anywhere (including tab title); audit row per view; no PHI in server logs (grep a fake patient name/DOB); same-name patients distinguishable; existing Notes/billing screens unchanged. Rollback: new routes only, revert revision.
5b. **Phase 5b, create-from-visit, needs-link queue, double-press guard, demographics UI.** Staging check: from a fake visit, one action creates the encounter with prefilled patient/date/program and blank ICD-10/charge; second press returns the same one; Notes-only user is refused; queue lists unlinked rows and clears on link; demographics save empty and filled, none required, no values in logs.
6. **Phase 6, Desktop** shows "linked appointment/encounter" and sends the ids on new recordings; MCP updated. Signed app rebuilt from the pushed commit.
7. Optional later, only if wanted: tighten (e.g. required patient on schedule rows). Not part of this proposal.

## 6a. Create Encounter from a Visit (new)

One action on the visit creates the billing Encounter and sets `Visit.encounterId`, in one transaction.

- Route: `POST /api/desktop/v1/notes/visits/[id]/encounter` (Desktop) and the same action in the web Visit screen. Body: optional `programId`; nothing else is required. Response: `{ encounterId, created: boolean }`.
- Prefill: `patientId` and `encounterDate` from the Visit (`visitDate`); `programId` by exact match of `Visit.program` to `Program.name` (active only). If no match, the call returns 422 asking the user to pick a program (programId is required on Encounter). `icd10Codes` (empty) and `chargeCode` (empty) are left for billing; `note` empty. `createdById` = the caller.
- Idempotent: if the Visit already has a live (not soft-deleted) `encounterId`, return it with `created: false` instead of creating a second one. If the linked encounter was soft-deleted, a new one may be created and the link replaced.
- Reuse: if the same patient already has exactly one live Encounter that date with the same program, offer it ("link existing") rather than create a duplicate. Never auto-link silently.
- Permissions: requires **Notes edit** (to modify the Visit) AND **Billing edit** (to create an Encounter, matching the existing `createEncounter` action). Users with only one get a clear 403 and the button is hidden. Respect the existing billing patient scoping (`patientScope`).
- Audit: `audit(email, "billing.encounter.create", "encounter <id> patient <id> from visit <id>")` plus the existing `BillingHistory` snapshot; ids only, no content. Visit-from-Encounter is not built.
- Billing screen shows "from visit" on such encounters so billing can open the visit context.

## 6b. Double-press guard on Record (new)

Two recordings of one appointment only happen when Record is pressed twice, so prevent it and tolerate it.
- Desktop: if a recording already exists for the selected schedule row, Record changes to "Open recording"; a second needs an explicit "Record another" confirm. Also disable the button for a few seconds after a press.
- Server: `notes/visits` POST accepts an optional client `idempotencyKey` (nullable, unique per key); a repeat returns the existing Visit instead of creating another (covers retries and double clicks). Additive column.
- If it happens anyway, both Visits link to the same ScheduleEntry/Encounter (as decided); the timeline groups them under the appointment with a "2 recordings" badge so staff can delete the stray one with the existing visit delete.

## 6c. "Needs link" queue (new)

A staff-visible list (web Notes area and Desktop) of: Visits with `scheduleEntryId` null (excluding ones flagged "no appointment"), ScheduleEntry rows with `patientId` null, and Visits with no encounter once documents are final.
- Each row offers: pick from candidates (same patient and date first, then +-1 day) and link, or "walk-in / no appointment", which sets `Visit.noScheduleEntry` (additive boolean, default false) so it leaves the queue.
- Needs Notes edit to link. Every link/unlink is audited (ids only). Count badge on the Notes tab.
- This replaces fuzzy auto-matching: the backfill stays exact, people resolve the rest here.

## 6d. Patients tab: one page per patient (new)

A top-level **Patients** tab (`/patients`, list + `/patients/[id]` detail) that is the single place to see everything about one patient. It is a **read view that composes existing data through the relations in section 1; it stores nothing of its own** and creates no second copy of any record.

**Detail page, in this order:**
1. Header: name (see names rule), MRN, DOB/age, merged-into notice, "needs link" count.
2. Demographics (section 8, all optional; empty ones hidden for viewers, shown as editable blanks for editors).
3. Schedule history: appointments (`ScheduleEntry` by `patientId`) with date, time, provider, type/track, status (completed / canceled / absent / missed) and, per row, the linked visit(s).
4. Visits: `Visit` rows with provider, program, transcript present/absent, and their `VisitDocument`s (kind, draft/final); each opens the existing Notes document editor, no new editor. Linked encounter shown on each visit.
5. Billing encounters: date, program, ICD-10 codes, charge code, Getix-entered status, "from visit" link; opens the existing billing encounter screen.
6. Consents: `PatientConsent` history with the active one marked.
7. Timeline: one merged, date-ordered list of all of the above (appointment, recording, document saved/finalized, encounter created, consent given/revoked), built from the same rows, with "2 recordings" grouping (6b). Filter by type.

**Access (module-based, nothing new):** the page shows each section only if the viewer has the module for it: Schedule history needs Schedule view, Visits/documents/transcripts need Notes view, Encounters need Billing view, Consents need whichever module the consent screen uses today, Demographics follow patient visibility (`patientScope`). A user with none of them gets the existing denied page; a user with some sees only those sections (a section hidden is not a placeholder with data). Editing stays where it is today (Notes edit, Billing edit); the Patients tab adds no new edit rights except demographics edit (Billing edit, section 8). Shared-records rule applies: no per-creator hiding.

**PHI / audit / logging:** every detail-page view is audited ("patient.view", user, patient id, which sections were rendered; no values). The list/search is audited as a count, not the query text. No PHI in logs, URLs (id only, never name or MRN in the path/query for views), error messages, or analytics; search terms are sent as a POST/body or kept out of server logs. Transcripts are loaded only when the Visits section is expanded (lazy), so a page view does not pull every transcript. Pages are no-store, no client-side caching of PHI.

**Search:** one box matching last/first name (prefix, case-insensitive), exact MRN, and initials (e.g. "JS"). Results: respect `patientScope`; merged patients resolve to their target; same-name results show MRN and DOB (if present) to tell them apart; capped list with "refine search". Initials search only matches within what the viewer may see.

**Names vs initials:** follows the existing per-user `User.showFullNames` setting (already built on the MFA/TOTP line of work; this branch must pick it up before Phase 5). When off, the whole page, list and search results show initials only (the page title, breadcrumbs and browser tab title too); when on, full name. Demographics beyond the name (DOB, phone, address) are shown only on the detail page and only to users allowed full names; initials-only users see age-less identification (initials + MRN). Search by full name for an initials-only user is still allowed (they type what they know) but results display initials. If unset, default is initials only.

**Needs-link queue entry point:** a "Needs link" badge on the Patients tab nav and on the patient header; a filter on the list ("Needs link") opens the queue (section 6c) scoped to the patient or to everyone. The queue and this page share the same link/unlink action.

**Relation to existing screens (reuse, no duplicate data):**
- Notes board stays the day/provider workflow view; the Patients tab is the patient-centric view. Both read `Visit`/`VisitDocument`; "Open in Notes" links go from the page to the existing document editor; nothing is copied.
- Billing screens (`/billing/patients`, encounters) stay the place to enter and edit encounters and manage patients; `/billing/patients/[id]` becomes a redirect (or links) to the new page once it covers its content, with its history view still reachable. Patient create/merge/MRN edit stay in billing until moved deliberately.
- Schedule keeps editing appointments; the page only displays them and offers "link patient" for rows with no patient.
- Shared components: reuse the existing consent panel, document list and encounter row components rather than new ones.

## 7. Open questions: Sohail's answers (resolved)

1. Visit with no schedule entry: YES (stays nullable; `noScheduleEntry` flag for the queue).
2. Encounter created from the Visit: YES, section 6a.
3. Demographics: YES, all optional, section 8.
4. Two recordings on one appointment: link both to the same entry/encounter; double-press guard added (6b).
5. Visible "needs link" queue: YES (6c).

Remaining small points (defaults proposed; tell me only if you disagree): (a) the exact demographics list in section 8; (b) Billing edit is required to create the encounter from a visit, so a provider with Notes edit only cannot.

## 8. Demographics (optional, none mandatory)

Proposed nullable columns on `Patient`: `dateOfBirth` (YYYY-MM-DD string like other dates), `phone`, `email`, `sex`, `preferredName`, `address` (one text field), `emergencyContactName`, `emergencyContactPhone`. Insurance stays out (Getix is the system of record). Nothing blocks create or save when empty; existing rows stay null; additive and nullable, so prod-safe.

Where they show: Patient detail header (DOB and age), Billing patient edit form, and DOB only on schedule/visit headers to prevent same-name mix-ups. Visit lists and search results show name (+MRN) only, never DOB. The existing same-name duplicate prompt shows DOB when known.

PHI / audit / logging:
- DOB and contact data are PHI: never in logs, error messages, URLs or query strings, or feedback payloads. Logs record who did what to which id, not values.
- Audit: reads of the full demographics panel and every change are audited (ids and field names changed, never values); `BillingHistory` keeps the prior snapshot, admin-only to view.
- Access: view follows today's patient visibility (`patientScope`); edit needs Billing edit (Notes edit on the patient page to be confirmed). Desktop `patients` routes return demographics only to authorized callers and the Desktop must not cache them to disk.
- Not sent to AI note-generation prompts; if a template needs age, pass age, not DOB. No PHI in fine-tuning (playbook).
- MCP tools do not return demographics by default.

## 9. Applies

Applies to MCP: new route `visits/[id]/encounter` as a tool (needs notes + billing edit), a needs-link listing, optional demographics on patient tools (not returned by default), and optional `scheduleEntryId`, `encounterId`, `providerId` to the visit create/read/search tools and return them in visit results; patient lookup tool can list a patient's linked schedule entries/visits/encounters/documents as one timeline. No tool is renamed (rename is code-internal). Additive; old calls still work.

Applies to Desktop: create-encounter action on a visit, needs-link list, Open recording / Record another guard with `idempotencyKey`, optional demographics display; and when recording from a schedule row, send `scheduleEntryId` (and `providerId` from `api/desktop/v1/providers`) with the visit create; show linked appointment/encounter on the visit; all optional fields so v1.0.x builds keep working until updated. "Promote to production" must carry the links only if the target ids resolve in prod (they will not, since ids differ per environment): the promote flow should re-resolve schedule/encounter/provider by patient+date+provider in the target and leave them null when not found.

## 10. Constraint: production must not be corrupted

Sohail's rule (revised): production data must not be lost, overwritten or corrupted. Old-Desktop compatibility is NOT required; the Desktop app is synced (new build released) first, then the SaaS change follows.

### 10.1 Production safety (unchanged, binding)
- Additive schema only: new nullable columns, indexes, FKs (`ON DELETE SET NULL`). No drop, no rename of a table or column, no type change, no NOT NULL added, no destructive migration, never `--accept-data-loss`. The Phase 1 rename is Prisma-level (`@@map`) and must emit **zero SQL** (proof: empty `prisma migrate diff`, no new migration folder; any SQL output stops the phase).
- Before every prod step: on-demand backup, then counts-only row counts (no PHI) for Patient, Visit, VisitDocument, Encounter, ScheduleEntry, PatientConsent; equal after, or stop and roll back.
- Backfill only fills NULLs, dry-run by default, never overwrites a manual link, runs on prod only via the Production agent with Sohail's approval.

### 10.2 Ordering with the Desktop
- The new Desktop build ships and is installed first. Because the Desktop is the main writer of visits, SaaS changes that it depends on must exist before it uses them: so order is (a) SaaS Phase 2 additive columns and optional-field API on staging, (b) Desktop build against staging, (c) Sohail tests, (d) promote SaaS additive schema + API to prod, (e) release Desktop. Server stays tolerant (new fields optional) so the brief window where a Mac still runs the previous build does not break recording; this is a convenience, not a requirement, and no frozen contract fixture is needed.
- Fields the Desktop uses today are still not removed or retyped without a reason; if a breaking change is wanted it is called out and goes to Sohail first.

### 10.3 Verification (lighter)
1. vitest additions for the new routes and the backfill matcher (fake data only).
2. After each phase, run the current Desktop build against staging through one full fake-data flow (sign in, schedule, visit, transcript, generate, edit, PDF, delete, consent). 
3. Schema checks: additive-migration gate, Phase 1 empty `migrate diff`, row counts before/after on prod steps.

### 10.4 Rollback per phase
- **Phase 1:** no DB change; revert the commit / shift traffic to the prior revision.
- **Phase 2:** columns are nullable and unused by the previous revision; shift traffic back, leave the columns (dropping needs Sohail's approval). Backup is the last resort.
- **Phase 3 (staging backfill):** null the filled columns for the logged ids, or re-seed staging.
- **Phase 4 (prod):** traffic shift back; prod backfill rolled back by nulling the ids the run recorded; pre-step backup for anything unexpected.
- **Phase 5/6:** new routes and UI are prior-revision reversible; entered demographics stay in nullable columns; keep the previous signed Desktop available.
- Gate to next phase: tests green, staging flow green, counts equal.

Applies to MCP (Patients tab): read-only patient overview and search tools mirroring the page's permission gating and names/initials rule; audited; no demographics by default.

Applies to Desktop (Patients tab): none required; the Desktop may later link to the web page by patient id. The Desktop shows initials today, consistent with the names rule.
