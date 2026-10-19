# Practice Management: Requirements v15

Status: Draft (current version)
Date: 2026-10-17
Owner: Sohail
Supersedes: [requirements-v14.md](requirements-v14.md) (and v1 to v13), which are kept as originally delivered.

There are no phased milestones; each version is delivered in a single release.

## Changes since v14
- **Past due is always shown to everybody**, even when empty ("Nothing past due."), not only when it has tasks (TSK-37).
- **Razak and Muntaha can see each other's tasks, read-only.** The Admin controls, per person, whose task lists they may also view; those lists appear as extra tabs (TSK-38, TSK-39, AUTH-10).
- **Default access:** Razak and Muntaha now have Schedule (edit), Tasks (edit) and Billing (edit). New logins start with Schedule (edit), Tasks (edit), Employees (view), no Billing or Ledger (AUTH-11).
- **Logins for Dr Lucy and Dr Irfan:** a "Give login" button on the Employees page (needs their Google email); adding a user also creates their employee record so everyone has a task list (EMP-6, AUTH-12).
- **One "today" for everybody:** dates such as today, Past due and recurring tasks use the practice's time zone (Pacific) rather than the server's or browser's (NFR).

## Changes in v14 (since v13)
- **Editing a recurring task keeps the assignee's queue in line with it** (TSK-32 to TSK-36). Fixes: moving a start date later left the already-created task on the board.

## Changes in v13 (since v12)
- **One-time tasks can have an expiration (end) date, or none** (the default). An unfinished task past its expiration date leaves the queue and goes to a collapsed **Expired** section; it can be restored by changing or clearing the date (TSK-29 to TSK-31).
- **Recurring tasks show up on their specific day**, not before: a recurring task that starts on a later date adds nothing to the assignee's queue until that date arrives (TSK-23).

## Changes in v12 (since v11)
- **End date or no expiration** is now an explicit choice on recurring tasks: "Never ends" or "Ends on <date>" (TSK-22, TSK-28). A one-time task already has an optional due date (TSK-1, TSK-4).

## Changes in v11 (since v10)
- **Daily recurring tasks run on weekdays only** (Monday to Friday); nothing is created for Saturday or Sunday (TSK-22, TSK-23).

## Changes in v10 (since v9)
- **Recurring tasks** (daily, weekly or monthly) that create a task in the assignee's queue each time they come due, managed on a new **Recurring** tab (TSK-22 to TSK-27).
- **Admin's own tab is first** among the task tabs, followed by the other employees A to Z, Unassigned, then Recurring (TSK-7).
- **New employees with task tabs:** Dr Lucy and Dr Irfan (EMP-5).
- **Drag and drop is Admin-only** everywhere: reordering tasks, task tabs and the navigation bar. Other users do not see the drag handles, and the server refuses a reorder from a non-admin (TSK-10, TSK-21, NAV-5).

## Changes in v9 (since v8)
- **Drag to reorder tabs:** the Admin can drag the employee tabs on the Tasks page into any order, and any user can drag the modules in the left navigation bar; the order is remembered (NAV-5, TSK-21).

## Changes in v8 (since v7)
- **Task board sections are now Past due, Today, Backlog and Completed.** The per-category sections ("B & BC", "No category", and so on) are gone. Tasks due today appear in Today automatically; overdue open tasks appear in a Past due section above Today, with a red high-priority flag (TSK-2, TSK-18 to TSK-20).

## Changes in v7 (since v6)
- **New Ledger module** for tracking business cash in and out, laid out like the practice's ledger spreadsheet (LED-1 to LED-14). Ledger is a sixth module in the access matrix.
- **Colour theme changed from purple to navy and white**, taken from the ledger spreadsheet's navy header rows; table headers are navy with white text (UI-1, UI-2, UI-5, UI-7).
- **Navigation pin** is one toggle button that changes as you pin or unpin (filled pin when pinned, outlined and tilted when unpinned), always visible, also in the collapsed rail (NAV-2).

## Changes in v6 (since v5)
- **Smaller type** across the app and a compact task card (UI-6, TSK-13).
- **Navigation pin fixed:** the pin button no longer overlaps the app name (NAV-2).
- **Resizable navigation:** drag the bar's right edge to widen it, up to one third of the window (NAV-4).
- **Tasks Analytics tab** and a **Todos | Analytics** switcher with a gear for categories, ported from the Todo App (TSK-15 to TSK-17).
- **Completion date** is stored on each task and shown as "Completed Oct 12" (TSK-16).

## Changes in v5 (since v4)
- **Task board look** follows the Todo App screenshot: large section headings with a "+" button and a count, one white card per task, pill-style category / due-date controls, a sun for Today, link and delete icons (TSK-3, TSK-13).
- **B & BC tasks imported** from the live Todo App into Sohail's task list, and a re-runnable import script for future moves (TSK-12, TSK-14).
- **Navigation pin** is a visible pin button at the top of the navigation bar (NAV-2).

## Changes in v4 (since v3)
- **New Billing module** (BIL-1 to BIL-24), modeled on the existing `bandbc-billing-app`: providers record billing for each patient encounter, and the administrator tracks which encounters have been entered into GetIX. Billing is a fourth module in the per-module access matrix.

## Changes in v3 (since v2)
- **Light and dark mode**, chosen per user in a new **Settings** page (SET-1 to SET-4).
- **Visual design** follows the reference image [assets/ui-reference-v3.png](assets/ui-reference-v3.png): dark or white left navigation with a purple active item, a rounded content panel, rounded cards, line icons, and a collapsed icon-only rail (UI-1 to UI-5).

## Changes in v2 (since v1)
- **Left navigation bar** that can be pinned or unpinned (NAV-1 to NAV-3).
- **Schedule** is now an Excel-like grid with provider dropdown, in Day, Week and Month views (SCH-4 to SCH-7, SCH-10). Seeded providers are Dr. Khalid Ahmed and Dr. Lucy.
- **Tasks** now work like the Todo App: drag-and-drop prioritizing, instant inline editing (TSK-2, TSK-3, TSK-10).
- **Task visibility and employee tabs:** non-admins see only their own tasks; the Admin sees one tab per employee (TSK-6, TSK-7).


## 1. Overview
A web application for running an outpatient behavioral health practice day to day. It has six modules: **Authentication & Access**, **Schedule Management**, **Tasks**, **Employees**, **Billing**, and **Ledger**. Sign-in is through Google OAuth only, and an administrator decides who may use the app and which modules each person can open.

## 2. Goals
- Admin controls who can sign in and which modules each person can use, and at what level (none, view, edit).
- Sign in with Google only; the app stores no passwords.
- A schedule board that looks and works like the practice's current Excel "Outpatient Board" (provider table, then day blocks with Psych Eval slots and Track sections).
- Import schedule data from an Excel file shaped like the existing board, on demand.
- Track tasks assigned to employees.
- Keep an employee directory.

## 3. Non-Goals (v1)
- Billing, insurance claims, or a full clinical record.
- Sign-in methods other than Google.
- Native mobile apps (the web UI should still be usable on a phone).
- Importing any data as part of delivery. The importer is built; the user runs imports later with their own file.

## 4. Users and Roles
| Person | Email | Role | Title | Notes |
|--------|-------|------|-------|-------|
| Sohail | sohail30@gmail.com | Admin | Administrator | Full access, manages users |
| Dr Khalid | khalid21631@gmail.com | Provider (clinician) | Doctor | Appears as a provider on the schedule |
| Razak Ahmed | Razakahmed19@gmail.com | Staff | Office Manager | |
| Muntaha | muntahastar@gmail.com | Staff | Office Manager | |

Roles are labels (Admin / Provider / Staff); real permissions come from the per-module access levels in AUTH-4 (access is purely per module). Only Admin can open the Access module.

## 5. Functional Requirements

### 5.0 Application shell
| ID | Requirement | Priority |
|----|-------------|----------|
| NAV-1 | Modules appear in a left navigation bar (Schedule, Tasks, Employees, and Access for Admin). Only modules the user can open are listed. | Must |
| NAV-2 | The bar can be pinned (always expanded) or unpinned (collapsed to an icon rail that expands on hover) with a single pin toggle at the top of the bar next to the app name. The toggle changes with the state (filled pin and "Unpin" tooltip when pinned; outlined, tilted pin and "Pin" tooltip when unpinned), never overlaps the app name, and stays visible in the collapsed rail (under the logo). The choice is remembered per browser. | Must |
| NAV-4 | The navigation bar can be resized by dragging its right edge (minimum 200 px, maximum one third of the window width); double-click resets it. The width is remembered per browser. Unpinned (icon rail) mode is fixed width. | Must |
| NAV-5 | The Admin can reorder the module links in the left navigation bar by dragging a grip that appears on hover (Home, Settings and Sign out stay in place). The order is remembered in this browser; a module added later appears at the end. | Must |
| NAV-3 | The signed-in user's name and a sign-out button are in the bar. | Must |

### 5.0a Settings and appearance
| ID | Requirement | Priority |
|----|-------------|----------|
| SET-1 | Every signed-in user has a Settings page (reachable from the navigation bar). | Must |
| SET-2 | The user chooses a theme: **Light**, **Dark**, or **System** (follows the device). The default is System. | Must |
| SET-3 | The choice is stored with the user, so it follows them across browsers and devices. | Must |
| SET-4 | The theme is applied on first paint (no flash of the wrong theme) and covers every screen, including the schedule grid, tasks board, month view and import. | Must |

### 5.0b Visual design
Reference: [assets/ui-reference-v3.png](assets/ui-reference-v3.png).

| ID | Requirement | Priority |
|----|-------------|----------|
| UI-1 | Left navigation: in dark mode a dark navy bar, in light mode a white bar. The app logo and name sit at the top, module links below with a line icon each, and Settings, pin and sign-out grouped at the bottom. | Must |
| UI-2 | The active module is a filled navy rounded pill with white text. | Must |
| UI-3 | The content sits on a soft panel with a large rounded top-left corner next to the navigation bar; content is shown in rounded cards with light shadows. | Must |
| UI-4 | The collapsed (unpinned) navigation is an icon-only rail where the active module is a navy rounded square; it expands on hover (see NAV-2). | Must |
| UI-7 | Table and grid headers are navy with white bold text, like the header row of the ledger spreadsheet. | Must |
| UI-6 | Type is compact: base size 13 px, task titles 13 px, pills and dropdowns about 11 px, section headings 14 px, matching the Todo App's density. | Must |
| UI-5 | Both themes keep text and controls readable (contrast) and use one navy accent (a lighter blue in dark mode). | Must |

### 5.1 Module 1: Authentication & Access
| ID | Requirement | Priority |
|----|-------------|----------|
| AUTH-1 | Users sign in with Google OAuth 2.0 / OpenID Connect. No local passwords. | Must |
| AUTH-2 | Only emails present in the Users list and marked active may sign in. Anyone else sees an "access denied" message. | Must |
| AUTH-3 | Admin can add, deactivate, and reactivate users. | Must |
| AUTH-4 | Admin sets each user's access per module (Schedule, Tasks, Employees, Billing, Ledger) as none, view, or edit. Admin role has edit on everything plus the Access module. | Must |
| AUTH-5 | Access is enforced on the server for every page and action, not only by hiding navigation. | Must |
| AUTH-6 | Sessions expire after inactivity; users can sign out. | Must |
| AUTH-7 | The last active Admin cannot be deactivated or demoted. | Must |
| AUTH-8 | Audit log records sign-ins (success and denied), user changes, and access changes: who, what, when. Admin can view it. | Should |
| AUTH-10 | The Admin can grant a user **read-only access to other employees' task lists**. Others' lists open as extra tabs after the user's own; the tasks cannot be changed, added to, or reordered by the viewer, enforced on the server. Seed: Razak and Muntaha can view each other's. | Must |
| AUTH-11 | A new login starts with Schedule (edit), Tasks (edit), Employees (view), Billing (none) and Ledger (none). Billing is granted to Razak and Muntaha. | Must |
| AUTH-12 | Adding a user creates a linked employee record if none exists for that email, so every login has a task list. | Must |
| AUTH-9 | Seed data creates the four users above, with Sohail as Admin. | Must |

### 5.2 Module 2: Schedule Management
Modeled on the sheet "Doc& HP 8.10-8.22" in the practice's Outpatient Board workbook.

**Providers table** (top of the sheet)
| ID | Requirement | Priority |
|----|-------------|----------|
| SCH-1 | Maintain providers with: name, contact number, NPI, Zoom link, Zoom password, working hours text (e.g. "M, T 8-2:00"), notes. | Must |
| SCH-2 | A provider may be linked to an employee or exist as an external provider (not an employee). | Must |
| SCH-3 | Zoom password and NPI are shown only to users with edit access to Schedule. | Must |

**Schedule grid**
| ID | Requirement | Priority |
|----|-------------|----------|
| SCH-4 | The schedule is an Excel-like grid: one row per entry, with columns Section (Psych Eval / Track), Time or Track, Type, Client (patient), Provider, and status checkboxes Absent, Canceled, Completed, Missed. Cells are edited in place and save automatically. | Must |
| SCH-5 | Provider is chosen from a dropdown of the providers in the app. Seeded providers: Dr. Khalid Ahmed and Dr. Lucy. | Must |
| SCH-6 | Three views: **Day**, **Week** (the default working view: the whole week in one grid, grouped by day with a header per day and an "add row" per day) and **Month** (calendar grid showing, per day, the number of entries, per-provider counts and status counts; clicking a day opens it). | Must |
| SCH-7 | Navigate previous / next / today in each view; filter by provider. | Must |
| SCH-8 | Create, edit, and delete entries (edit access); view-only for view access. | Must |
| SCH-9 | Track names (with time windows) and entry types are configurable and offered as suggestions in the grid. Seeded tracks: Track 1 IOP, Track 1 PHP, Track 2 IOP, AM 2 IOP, AM 3 IOP, Bell Adol IOP, EVE 1 IOP, PM IOP. Seeded types: Follow-up, Follow-up & Admit Order, DC Orders Only. | Should |
| SCH-10 | Totals of scheduled, completed, absent, canceled, missed per day (and per month cell). | Should |

**Excel import**
| ID | Requirement | Priority |
|----|-------------|----------|
| IMP-1 | Upload an .xlsx file, choose which sheet to import, and see a preview before anything is saved. | Must |
| IMP-2 | The default parser understands the reference layout: providers table in the first rows, then day blocks with the date in a merged cell (Excel serial date), Psych Eval rows, and Track rows with columns Time/Track, Type, Client Info, Absent, Canceled, Provider, Completed, Missed. | Must |
| IMP-3 | Skip empty rows and template placeholders such as "Select Time", "Select Type", "Select Provider". | Must |
| IMP-4 | Match provider names to existing providers; unmatched names are listed and can be created as external providers or mapped to an existing one before commit. | Must |
| IMP-5 | Preview shows counts (rows found, new, duplicates, skipped, unmatched providers) and any row-level warnings. | Must |
| IMP-6 | Commit is explicit. Re-importing the same file does not create duplicates (match on date, time or track, provider, client info). | Must |
| IMP-7 | Each import is logged: file name, sheet, who, when, counts. | Should |
| IMP-8 | Importing provider table rows is optional (checkbox) and never overwrites existing Zoom passwords unless chosen. | Should |
| IMP-9 | Only users with edit access to Schedule can import. | Must |

### 5.3 Module 3: Tasks
The experience follows the existing Sohail Todo App (`Sohail_Todo_App`, a React app), so B&BC tasks can later be moved in. A task belongs to a person and can be reassigned.

| ID | Requirement | Priority |
|----|-------------|----------|
| TSK-1 | A task has: title, optional category, assignee (employee), optional due date (YYYY-MM-DD), completed flag, "Today" flag, ordering, and zero or more links. | Must |
| TSK-2 | The task area is a list of collapsible sections: **Past due** (shown only when something is overdue), **Today**, **Backlog**, **Completed** (collapsed by default). Each section shows a live count and Today and Backlog have a "+" button for an inline add box. | Must |
| TSK-3 | Per-task row: drag handle, complete checkbox, click-to-edit title (blank rejected), category dropdown, assignee dropdown, due-date pill with date picker, Today toggle, link button, delete. Changes apply instantly without a page reload. | Must |
| TSK-4 | Due-date pill: "+ Due date" if unset; "Today"; "Tomorrow"; "Overdue Nd"; otherwise a short date (e.g. "Oct 29"). | Must |
| TSK-5 | Tasks can be reassigned at any time (recorded in the audit log). | Must |
| TSK-6 | **Visibility:** a non-admin user sees the tasks assigned to them, can change only those, and can additionally see (read-only) the task lists the Admin has granted them (AUTH-10). Anything else is refused on the server, whatever the address says. | Must |
| TSK-7 | **Employee tabs (Admin):** the Admin sees a tab per employee (plus Unassigned and Recurring), each employee tab showing that person's tasks with an open-task count. The Admin's own tab is first, then the others A to Z. Non-admins see no employee tabs, only their own list and a Recurring view. | Must |
| TSK-8 | Links: attach URLs to a task; type is auto-detected: webex.com = Webex; `/pull/<n>`, `/pull-requests/<n>`, `/merge_requests/<n>` = PR; `.md` = Markdown; `.doc`/`.docx` or docs.google.com = Doc; otherwise Link. Links open in a new tab and can be removed. | Must |
| TSK-9 | Categories are user-defined labels (add, rename, delete). Deleting a category un-categorizes its tasks. Seeded with "B & BC" (as a label only, not a section). | Must |
| TSK-10 | **Prioritizing:** the **Admin only** can reorder tasks by drag and drop within Today, Backlog and Completed; the order is saved. Other users see no drag handles, and the server rejects reorder requests from them. | Must |
| TSK-11 | View access can see tasks (own only, unless Admin); edit access can create and change them. | Must |
| TSK-12 | The existing "B & BC" tasks from the Todo App are imported into the Tasks module (done for Sohail's list: 10 tasks, 4 open and 6 completed, with due dates, Today flags and order kept). | Must |
| TSK-13 | Each section heading has a "+" button that opens an inline add box; there is no always-visible add box. Task rows are separate rounded cards; the category and assignee are pill dropdowns; the Today toggle is an orange sun when on. | Must |
| TSK-15 | The Tasks page has a **Todos | Analytics** switcher. Analytics shows, for the tasks in view (the signed-in person's, or the employee tab the Admin has open): a stacked daily-velocity bar chart for the last 30 days colored by category with a legend; a by-category table (completed, average per day, total); and a daily breakdown table. | Must |
| TSK-16 | Each task stores when it was completed (cleared if reopened) and when it was last changed. A completed task shows "Completed Oct 12" (or "Completed (date unknown)" for tasks finished before dates were tracked). | Must |
| TSK-17 | A gear button next to the switcher shows or hides category management (add, rename, delete). | Must |
| TSK-18 | **Past due** holds open tasks whose due date is before today, most overdue first, under a red heading with a high-priority flag, and each of its tasks shows the flag. Past due is sorted by due date, so it is not drag-reorderable. A task appears in only one section. | Must |
| TSK-19 | **Today** holds open tasks that are due today or flagged for Today (the sun). **Backlog** holds every other open task. Changing a due date or the sun moves a task between sections immediately. | Must |
| TSK-20 | Categories are no longer shown as sections. A task keeps an optional category label (dropdown on the row, managed with the gear, used by Analytics); existing categories and imported tasks keep theirs. | Must |
| TSK-21 | The Admin can reorder the tabs (employees, Unassigned, Recurring) by dragging a grip on each tab. Clicking a tab still opens it. The order is remembered in this browser; an employee added later appears at the end. | Must |
| TSK-22 | A **recurring task** has a title, an assignee, a frequency (**daily**, meaning every weekday Monday to Friday, **weekly** on a chosen weekday, or **monthly** on a chosen day 1 to 31, using the last day for shorter months), a start date and an end that is either **"Never ends"** (no expiration) or **"Ends on"** a chosen date (no tasks are created after it), and can be paused (active off) or deleted. | Must |
| TSK-23 | Each time a recurring task comes due (a daily task never comes due on a Saturday or Sunday; over a weekend its latest occurrence stays the previous Friday), **one task is created in the assignee's queue**, due on that date, so it appears in Today and later in Past due until checked off. Only the most recent occurrence is created, so a long absence does not flood the queue; each occurrence is created once. A recurring task that has not started yet creates nothing until its start day arrives (it "shows up on that specific day"). | Must |
| TSK-24 | A new **Recurring** tab lists the recurring tasks with assignee, schedule, next due date, start, end and active, all editable in place, with a form to add one. The Admin sees and assigns all of them; other users see and create only their own. | Must |
| TSK-25 | Created tasks carry the category "Recurring tasks" (so Analytics can count them) and a ↻ badge. Deleting a recurring task stops future tasks; ones already created stay. | Must |
| TSK-26 | Recurring tasks follow the same visibility rule as tasks (TSK-6) and are audit-logged. | Must |
| TSK-27 | Recurrence rules and generation are covered by automated tests. | Should |
| TSK-28 | The end choice is shown the same way when adding a recurring task and when editing one; switching to "Never ends" clears the end date, and an end date can't be before the start date. | Must |
| TSK-29 | Any task (one-time or created by a recurring task) can have an optional **expiration date**. The default is no expiration. It is set with an hourglass button on the task row, shown as an "Expires Oct 29" pill, and cleared with the pill's ×. The expiration date can't be before the due date. | Must |
| TSK-30 | An open task whose expiration date is before today is **Expired**: it leaves Past due, Today and Backlog, is not counted in open-task counts, and appears dimmed in a collapsed **Expired** section (shown only when something has expired). Completed tasks never expire. A task is still active on its expiration date itself. | Must |
| TSK-31 | Changing the expiration date to a later date, or clearing it, brings an expired task back into the queue. | Must |
| TSK-32 | **Reconcile on every change.** When a recurring task is created or edited (start or end date, frequency, weekday, day of month, paused or resumed, assignee, title), its already-created tasks are brought in line: an **open** task the rule no longer produces (before the start date, after the end date, on a weekday or day that is no longer used, or not yet due while paused) is **removed** from the queue. | Must |
| TSK-33 | **Finished tasks are history** and always stay, are never re-created, and keep their original assignee and title. | Must |
| TSK-34 | **Show up on the specific day, never back-filled by an edit.** Creating or changing a recurring task never adds tasks for earlier days; it generates from today onward. If the app is not opened on a day, the most recent missed occurrence still appears once (only one). | Must |
| TSK-35 | **Open tasks follow the recurring task:** reassigning it moves its open tasks to the new person, and renaming it renames open tasks whose title was not changed by hand. | Should |
| TSK-36 | The behaviour in TSK-32 to TSK-35 is covered by unit tests of the planning rules and by an end-to-end script (`npm run verify:recurring`) that runs against the database with synthetic data and removes it afterwards, and never touches real recurring tasks. | Should |
| TSK-37 | The **Past due** section is always shown for everyone, with "Nothing past due." when empty. (Expired is shown only when something has expired.) | Must |
| TSK-38 | When viewing someone else's list, a notice says it is read-only, and there are no add boxes, checkboxes, dropdowns, drag handles or delete buttons that act on it. | Must |
| TSK-39 | Open-task counts on tabs include only lists the user may view and exclude expired tasks. | Should |
| TSK-14 | A re-runnable script (`npm run import:todo`) imports a Todo App category into the Tasks module for a chosen person; tasks already present (same title, category and assignee) are skipped. | Should |

Not carried over from the Todo App: Firestore document sync / live SSE push (this app reads from its database; a page refresh shows other people's changes).

### 5.4 Module 4: Employees
| ID | Requirement | Priority |
|----|-------------|----------|
| EMP-1 | Employee directory: name, title, email, phone, active flag. | Must |
| EMP-2 | Create, edit, and deactivate employees. Deactivating keeps their history on schedules and tasks. | Must |
| EMP-3 | An employee is linked to a user account by matching email. | Should |
| EMP-4 | Employees are selectable as task assignees and as schedule providers. | Must |
| EMP-6 | The Admin can give an employee who has an email (their Google account) a login from the Employees page ("Give login"), with the default access in AUTH-11. Dr Lucy and Dr Irfan get logins this way once their emails are entered. | Must |
| EMP-5 | Seed the four employees: Sohail, Dr Khalid, Razak Ahmed, Muntaha, with the emails in section 4. Dr Khalid is linked to the provider "Dr. Khalid Ahmed". Also seed **Dr Lucy** (linked to the provider "Dr. Lucy") and **Dr Irfan**, doctors without a login, so they have task tabs and can be assigned tasks. | Must |

### 5.5 Module 5: Billing
Modeled on the practice's `bandbc-billing-app`. Providers record the billing information for each patient encounter; an administrator keys each encounter into GetIX and marks it done. **Nothing is erased:** deleting hides, and earlier versions are kept.

**Roles in Billing.** *Admin* = the Admin role. *Provider* = anyone with edit access to Billing who is not an Admin. Users with only view access can look but not record.

| ID | Requirement | Priority |
|----|-------------|----------|
| BIL-1 | A provider records an **encounter**: patient name (last, first), MRN (optional), encounter date, program, ICD-10 codes, and a charge code and/or a note. | Must |
| BIL-2 | The encounter date must be a real date and cannot be in the future. | Must |
| BIL-3 | Program is chosen from a list the Admin maintains (add, rename, deactivate). Inactive programs are not offered for new encounters. | Must |
| BIL-4 | ICD-10 codes: one or more (up to 25), separated by commas, semicolons or spaces; the first is the primary code. Codes are normalized (e.g. `e119` becomes `E11.9`) and checked for shape (not against the official list). The form shows the parsed codes as you type. | Must |
| BIL-5 | At least one of charge code or note is required. | Must |
| BIL-6 | **MRN is optional** when recording. If the MRN is already on file the encounter joins that patient; if the name does not match the one on file the form stops so it can be checked. | Must |
| BIL-7 | With no MRN, if the provider already has a patient with the same name, the form asks whether it is the same person; otherwise a new patient is saved as "No MRN yet". | Must |
| BIL-8 | A provider can add an encounter for a patient already on file by searching name or MRN, with no retyping and no duplicate record. "Save and add another" is offered. | Must |
| BIL-9 | **Visibility:** a provider sees the patients they have entered an encounter for, and each such patient's whole record, including colleagues' encounters. The Admin sees every patient and encounter. Seeing is not editing. | Must |
| BIL-10 | A provider can edit or delete only encounters they entered, and only while the encounter is not marked "Entered into GetIX". The Admin can change any unlocked encounter. | Must |
| BIL-11 | The Admin marks an encounter **Entered into GetIX** (recording who and when). It needs an MRN first. Once marked, the encounter is **locked**: nobody can edit or delete it until the Admin removes the mark. | Must |
| BIL-12 | Deleting an encounter hides it (soft delete). The Admin can show deleted encounters and restore them. | Must |
| BIL-13 | **Edit history:** before any change to an encounter or patient record, the previous version and who changed it is saved. The Admin can view it. History is append-only through the app. | Must |
| BIL-14 | **Encounters worklist:** the Admin's default view is encounters not yet in GetIX, oldest first; providers see their own encounters, newest first. Filters: patient name or MRN, date range, program, GetIX status, MRN missing, entered by (Admin), deleted (Admin). | Must |
| BIL-15 | **Patients list:** patients (scoped per BIL-9) with MRN, name, last seen, encounter count and how many are waiting for GetIX; filters for name/MRN, dates seen, program, waiting for GetIX, MRN missing. A patient page shows all of that patient's encounters. | Must |
| BIL-16 | The Admin can add a missing MRN to a patient. If that MRN already belongs to another record with the same name, the app offers to **merge** the two (encounters move to the kept record; the other is kept as merged, not erased). | Must |
| BIL-17 | The Admin can fix a mistyped name or MRN on a patient. | Must |
| BIL-18 | Billing actions are audit-logged (create/edit/delete/restore encounter, mark/unmark GetIX, add/fix MRN, merge, view history, view patient). Audit entries hold record ids only, never patient names, MRNs or codes. | Must |
| BIL-19 | No patient data in web addresses: pages are addressed by internal ids and searches do not put names or MRNs in the URL. | Must |
| BIL-20 | All billing access is enforced on the server per BIL-9 to BIL-11, not only hidden in the UI. | Must |
| BIL-21 | Seed: Dr Khalid has edit access to Billing; the Office Managers have none until the Admin grants it. | Should |
| BIL-22 | Billing appears in the left navigation for users with access, and in the module access matrix. | Must |
| BIL-23 | Billing data is hosted only where a Business Associate Agreement is in place before real patient data is entered (see section 6 and open questions). | Must |
| BIL-24 | Provider classification and payer rules from `provider-classification-and-billing.md` (e.g. ARNP vs MD for Medicare certification, supervised trainees) are **not** enforced in v4. | Could |

### 5.6 Module 6: Ledger
Tracks the business's cash in and cash out, in the same shape as the practice's ledger spreadsheet (Date, Cash In, Cash Out, Transaction By, Category, Method, Comments).

| ID | Requirement | Priority |
|----|-------------|----------|
| LED-1 | A ledger entry has: date, either cash in or cash out (a positive amount, not both), Transaction By (a person), Category, Method, and free-text comments. | Must |
| LED-2 | The ledger is an Excel-like grid with the columns above; cells are edited in place and save automatically. A new row is saved once it has a date and an amount. | Must |
| LED-3 | Amounts are stored as exact whole cents, accept input such as `1,000.00` or `$12.50`, and are shown as currency, right-aligned. | Must |
| LED-4 | Category, Method and Transaction By are dropdowns whose values are maintained in the app (add, rename, remove). Removing a value keeps the entries but clears that label. | Must |
| LED-5 | Seed categories: Deposit, Rent, Utilities, Insurance, Taxes, Payroll, Supplies, Software, Professional fees, Other expenses. Seed methods: Cash, Check, Zelle, ACH / bank transfer, Credit card. Seed Transaction By: the four people in section 4. | Should |
| LED-6 | Filters: date range (with presets This month, Last month, This year, All), category, method, transaction by, cash in only / out only, and text search in comments. The page opens on the current year. | Must |
| LED-7 | Totals for the filtered entries (cash in, cash out, net, number of entries) are always shown. | Must |
| LED-8 | A Summary page shows totals by category and by month for a date range. | Should |
| LED-9 | Export the filtered entries to CSV. Text cells that start with `=`, `+`, `-` or `@` are neutralized so spreadsheets do not run them as formulas. | Should |
| LED-10 | Access follows the per-module levels: view can read and export; edit can add, change and delete entries and edit the lists. Admin has full access. By default only the Admin has Ledger access. | Must |
| LED-11 | Every add, edit and delete is audit-logged with the date and amount, so a deleted entry can be traced. | Must |
| LED-12 | Dates must be real dates. Amounts are limited to $999,999,999.99. | Must |
| LED-13 | The ledger is for business records only; no patient information belongs in it. | Must |
| LED-14 | Importing the existing ledger spreadsheet is not part of v7. | Could |

## 6. Non-Functional Requirements
- **Security:** HTTPS in any deployment; server-side authorization on every request; secrets only in environment variables, never in the repo.
- **Sensitive data:** the schedule contains client information and Zoom passwords. The app must not be reachable without sign-in, and sensitive fields follow SCH-3. Whether the practice needs formal HIPAA controls (hosting agreements, encryption at rest, retention) is an open question.
- **Privacy:** only name and email are taken from Google.
- **Test data:** tests and fixtures use synthetic data only; real workbooks are never committed.
- **Time zone:** "today" is computed in the practice's time zone (`PRACTICE_TIMEZONE`, default America/Los_Angeles) on the server for every screen, so Today, Past due, recurring tasks and the home counts agree for everybody; a Cloud Run server (UTC) never rolls the date over early.
- **Performance:** day board and task list load in under 2 seconds for one practice (under 50 users, a few years of schedule data).
- **Usability:** desktop-first, responsive down to phone width.

## 7. Data Model (high level)
- User (email, name, role, active)
- ModuleAccess (user, module, level)
- Employee (name, title, email, phone, active)
- Provider (name, contact, NPI, zoom link, zoom password, hours, notes, optional employee)
- TrackDef (name, start, end), EntryType (name)
- ScheduleEntry (date, section, time label, track, type, client info, provider, absent, canceled, completed, missed, import batch)
- Category (name, sort order)
- Program (name, active)
- BillingPatient (MRN optional, last name, first name, created by, merged into)
- Encounter (patient, date, program, ICD-10 codes, charge code, note, GetIX entered/by/at, created/updated/deleted by and at)
- BillingHistory (entity, entity id, previous version, changed by, when)
- LedgerEntry (date, cash in, cash out, transaction by, category, method, comments)
- LedgerCategory, LedgerMethod, LedgerParty (name, order)
- Task (title, category, assignee, due date, completed, in-today, sort order)
- TaskLink (task, url, label, type)
- AuditLog (actor, action, detail, timestamp)
- ImportLog (file, sheet, user, counts, timestamp)

## 8. Integrations
- Google OAuth 2.0 / OpenID Connect for sign-in.

## 9. Assumptions and Constraints
- Single practice (single tenant).
- Every user has a Google account.
- Stack for v1: Next.js + TypeScript, Prisma with PostgreSQL, Auth.js (Google), exceljs for import.
- Hosting: Google Cloud Run (same platform as the Todo App) with Cloud SQL for PostgreSQL as the database. Cloud Run's filesystem is ephemeral, so a file-based database (SQLite) is not suitable. Secrets (OAuth client secret, auth secret, database URL) live in Secret Manager. Sign-in is handled inside the app (AUTH-1), not by Identity-Aware Proxy, because per-module access needs the app to know who the user is.
- Local development uses PostgreSQL in Docker (`docker-compose.yml`).
- The user supplies their own Google OAuth client ID and secret.
- Schedule content: both staff/provider assignments and client appointments, exactly as on the reference sheet (client info is free text).

## 10. Decisions and Open Questions
Decided:
- Fourth employee is Sohail (Admin). Razak Ahmed and Muntaha are Office Managers. Spelling "Muntaha" follows the email address.
- Role model: Admin / Provider / Staff labels with purely per-module access.
- Tasks are assigned to people and can be reassigned; layout follows the Sohail Todo App.
- Hosting: Google Cloud Run + Cloud SQL (Postgres).

Still open:
1. The reference sheet lists providers who are not among the four employees. v1 treats them as external providers. Confirm.
2. HIPAA obligations for client information (Google's BAA, encryption, retention, access review). Not claimed by v1.
3. Should Zoom passwords be stored in the app at all?
4. An import covers one sheet at a time in v1.
5. How and when to move the remaining Todo App categories (Studio, Integrations, Personal); v5 moved only "B & BC".
6. Billing: should Office Managers be able to mark encounters as entered into GetIX (v4: Admin only)?
7. Billing: should an encounter be creatable from a schedule entry (v4: no link between Schedule and Billing)?
8. Billing: should the app check ICD-10 codes against the official list (v4: shape only)?
9. Billing: Business Associate Agreement and hosting before any real patient data (see BIL-23).
10. Ledger: should the existing ledger spreadsheet be importable, and who besides the Admin should see it?
11. Ledger: do you want a running balance column or receipts attached to entries?
12. Dr Lucy's and Dr Irfan's Google emails (needed to give them a login), and whether they should get Billing access like Dr Khalid.
13. Should Razak and Muntaha also see each other's Recurring list (v15: they see only their own)?
