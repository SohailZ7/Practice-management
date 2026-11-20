# Web releases (one line each; hashes live only here)
# RULE: the new "Web 1.N" line goes in the SAME commit as the change it numbers (write "pending" for the hash). The app shows the highest line in the build it runs, so a line added later makes every build show the previous number.
Web 1.1 | safeguards: production data guards | 2cbb83b
Web 1.2 | shared pop-ups, Add-visit errors | c180cb5
Web 1.3 | full names for the recorder | f523d09
Web 1.4 | all modules in the left menu | 4e35fb2
Web 1.5 | Mac app updates, download page, diagnostics, update banner | 447dd0b
Web 1.6 | guarded task import script | ff3f426
Web 1.7 | Settings shows build and environment; Mac app card | cbb490b (staging, rev practice-mgmt-00056-kob)
Web 1.8 | Logs why the release manifest cannot be read | 7ca4aae (staging, rev practice-mgmt-00059-tob)
Web 1.9 | Notes document wording matches Desktop | 936f2a1 (staging, rev practice-mgmt-00061-hos)
Web 1.10 | Notes visits appear on the Schedule | da41fa8 (staging, rev practice-mgmt-00063-vad)
Web 1.11 | Recorder visit list needs Notes view only | 59663ea (staging, rev practice-mgmt-00065-vaz)
Web 1.12 | One Schedule tab: one-line visits with status, doc icons, row menu | 44afbca (staging, rev practice-mgmt-00067-zaq)
Web 1.13 | Note writer follows UHS documentation rules, with a fix-before-signing check | 9623e3a (staging, rev practice-mgmt-00069-buk)
Web 1.14 | Admin > Costs: monthly cloud cost per environment by service | cae6dd0 (staging, rev practice-mgmt-00071-qih)
Web 1.15 | Feedback workflow: statuses, approvers, test notes, comments, agent API | 8b8d959 (staging, rev practice-mgmt-00073-qam)
Web 1.16 | Promote to production button on the staging Schedule list (admin, browser sign-in to prod) | e37a308 (staging, rev practice-mgmt-00075-kij)
Web 1.17 | Feedback items record their release; production marks Approved items Shipped itself | 5c26e55 (staging, rev practice-mgmt-00077-gak)
Web 1.18 | Promote button checks production is ready before offering sign-in, with clear refusal messages | 422f832 (staging, rev practice-mgmt-00081-voj)
Web 1.19 | Schedule: sorted by time, time ranges, military time, provider column, full names, print (18pt); Tasks: one-week recurring view; Not B&B tracking-only providers | a7c1799 (staging, rev practice-mgmt-00083-foy)
Web 1.20 | Ledger API for Claude: ledger token scope, list/create/update/delete, options, totals; refuses patient info and exact duplicates | e0a4ab7 (staging, rev practice-mgmt-00085-ruj)
Web 1.21 | Admin: People tab (login + module access, one row per person), merged Task tabs, Save all bar on People, Task tabs and Timesheets; old Admin URLs redirect | 30565d5 (staging, rev practice-mgmt-00087-key)
Web 1.22 | Redesign foundation: new colors and fonts (Inter, Newsreader), sidebar, page headers, tables, pills, buttons; STAGING/PRODUCTION label in the sidebar; Schedule header and day summary | 3f99185 (staging, rev practice-mgmt-00089-pex)
Web 1.23 | Redesign: Billing (month heading, pill tabs, summary of shown/waiting/entered encounters, restyled list); tab style now shared by all screens | ea5bc42 (staging, rev practice-mgmt-00091-lep)
Web 1.24 | Desktop transcript inbox: upload by recording ID with no visit needed, idempotent with checksum, link later, list unlinked; 401 and 403 replies now say why | e4b59c6 (staging, rev practice-mgmt-00093-tah)
Web 1.25 | Schedule board loads faster (reads only the columns it shows); scheduled synthetic upload check route for the Desktop inbox (made-up text, no patient data) | cbe6ce2 (staging, rev practice-mgmt-00097-tuj)
Web 1.26 | Redesign (plum Practice Studio look): new sidebar with brand, workspace/manage groups, environment badge, user card; top bar with breadcrumb; Schedule page header, summary strip, and visits table (patient avatar, visit and program, document status pill) | 3273e77 (staging, rev practice-mgmt-00099-qam)
Web 1.27 | Redesign: Billing (headline and New encounter button, clickable stage cards All shown/Needs details/Waiting/Entered, restyled encounters table with patient avatar and MRN, stage pill) | 990027a (staging, rev practice-mgmt-00101-fet)
Web 1.28 | More automated tests (inbox retry/resume/checksum/restart, API error replies, access matrix, server-side guard scan, Billing list states), reduced-motion style rule, staging smoke script | 2bda8c4 (staging, rev practice-mgmt-00103-dum)
Web 1.29 | Redesign: Overview (greeting with date, hero card with next visit, four stat cards, today's schedule table, needs-attention and your-focus panels, links to other areas) | d274f88 (staging, rev practice-mgmt-00105-ses)
Web 1.30 | Redesign headers from the boards on Tasks, Team (Employees), Ledger, Feedback, Administration and Settings (eyebrow plus serif headline); page contents keep their working layouts | 0757cef (staging, rev practice-mgmt-00108-mar)
Web 1.31 | Settings: Compact and Privacy mode switches (this browser); top bar: Go-to menu (Command or Ctrl K, screens only, no patient search) and privacy button; patient names show as initials in privacy mode on Billing and Overview | b263d77 (staging, rev practice-mgmt-00110-tix)
Web 1.32 | Administration Save all: the confirmation is now in the page (Yes, save / Cancel) instead of a browser pop-up box; gate now checks all 14 screens turn away anonymous visitors | 34542ee (staging, rev practice-mgmt-00113-xif)
Web 1.33 | Rebuild: all delete/confirm questions asked in the page (no browser pop-ups, including consent date entry); Tasks progress and workload panels plus List/Board view; Billing Review side panel; Visit details side panel; Team Invite team member and Manage roles buttons | 2b0f119 | staging practice-mgmt-00115-nem
Web 1.34 | Feedback states simplified: New, Triaged (Accepted / Rejected / More info needed), Building, On Staging, Tested, Release to Prod; Tasks get Not started / In progress / Done status buttons; old words still read | 38c2e2f | staging practice-mgmt-00117-yec
Web 1.35 | Recording-consent gate: a window with one checkbox (Patient and everyone present gave consent) before Generate; saved per visit (who, when, wording version, new RecordingConsent table); Visit details shows it; Desktop inbox and transcript uploads and POST /visits/:id/consent accept an optional consent object | d09b635 (staging practice-mgmt-00069-x7h; on main)
Web 1.36 | See full names switch on the web (Settings, off by default, same as Desktop; shared PatientName component for every screen); Tasks list compact (repeat icon replaces the Recurring tasks pill, tighter cards) | PENDING
Web 1.37 | Feedback API for Claude (list_feedback, get_feedback) now includes the submitter name | PENDING
Web 1.38 | Appointment unification Release A: additive Visit columns, backfill/fingerprint/snapshot/rehearsal scripts and runbook (no visible change) | pending
Web 1.39 | Patients tab, phase 0 (staging only): /patients list (appointments, seen, absent, missed, cancelled, upcoming, last seen, providers, program, visit types) and /patients/[id] chart (visits, documents, encounters for billing viewers), derived from existing Visits and ScheduleEntry; notes view; no nav change yet | 25e47f9 | staging practice-mgmt-00141-soz
Web 1.40 | Phase 1 start: Visit statuses Missed and Other added to the shared list (recorder API shape unchanged); Patients tab counts Other | pending (committed, not deployed; staging deploys held until Release A is done on prod)
Web 1.41 | Reference lists: new additive RefItem table (visit types, charge codes with documentation type and non-billable, documentation types, order types), Administration > Lists to load starting lists and edit; not used by other screens yet | pending (committed, not deployed; NEW TABLE, additive: not part of the 1.38 promote)
Web 1.42 | Unification Release B1: Schedule, desktop schedule API (same shape) and Patients read Visits; rows with no patient stay as ScheduleEntry staging rows; linking a patient turns a staging row into a Visit; Visit list filter removed; mirror still written (rollback path); NO schema; requires Release A backfill on the environment first | 31d5826 pushed to main | staging practice-mgmt-00143-lep (then superseded)
Web 1.43 | Unification Release B2a: new additive UnmatchedAppointment table (rows with no patient), Schedule/import/desktop API read it, ScheduleEntry mirror retired, Visit time/program/provider columns kept in step by Notes edits; copy and verify script scripts/unify-copy-unmatched.ts; ScheduleEntry still exists (dropped in B2b) | 1eb9740 local, not pushed | staging practice-mgmt-00146-teh
Web 1.44 | Unification Release B2b: ScheduleEntry model removed (table dropped only through the approved, preflighted schema step: verified backup id, snapshot, exact copy counts); Release A backfill tooling retired | bdecc02 local, not pushed | staging practice-mgmt-00149-nuf; ScheduleEntry dropped on staging only
Web 1.45 | Unlink on a copied unmatched row now clears its patient link (found in the staging browser check); no schema | e2140b3 pushed | staging 00151-naj, smoke 142/0, unlink re-checked in browser
Web 1.46 | Schedule day order now uses the shared exact-time-first rule (10 AM, 9-11, 9-12, 1 PM, 12-3), same as Notes; no schema | 5b0bc23 pushed | staging 00159-nah
Web 1.47 | Full names switch (Settings) now defaults ON for users an admin allowed (was off, so ticking the Admin box still showed initials); Privacy mode still wins; no schema | pushed | staging 00159-nah (commit 6de2e28)
Web 1.48 | Navigation redesign: CLINICAL (Patients, Schedule, Billing, Reports), OPERATIONS (Tasks, Employees, Ledger), MANAGE (Feedback, Settings, Administration); Overview worklist counts; Reports landing page (reports not built yet); access mapping Patients=notes, Reports=billing; no schema | pushed | staging 00159-nah (commit 6de2e28)
Web 1.50 | Transcript viewer shows speaker turns with the speaker label and time on each (read from the stored text, nothing stored or rewritten); design note for speaker correction and segments | pushed | staging 00159-nah (commit 6de2e28)
Web 1.55 | Transcript speaker correction: a Who is who picker in the transcript viewer renames speakers for display (new nullable Visit.speakerLabels column; stored text unchanged) | pending (release number provisional until rebase at push)
