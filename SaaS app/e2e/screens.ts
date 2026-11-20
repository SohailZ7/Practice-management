// The list of every screen the regression suite covers. Add a line here when a page is added: screens.spec.ts and the
// coverage test (tests/screenCoverage.test.ts) fail if a page.tsx exists that is neither listed here nor explicitly skipped.
export type Screen = {
  name: string;
  path: string;
  /** Text that must be visible when the page rendered with the seeded fixture data. */
  expect: (string | RegExp)[];
  /** The page legitimately has inline form fields (date/select) inside table rows by default. */
  inlineFieldsOk?: boolean;
  /** Tables on the page may have deliberately uneven row heights (e.g. grouped/expandable rows). */
  unevenRowsOk?: boolean;
  /** Page is expected to redirect here (it has been merged into another page). */
  redirectsTo?: string;
  /** Page only exists on staging (404 elsewhere); the suite runs with APP_ENV=development so a 404 is expected. */
  notFoundOk?: boolean;
  /** KNOWN phone-width overflow in px that exists today (page not yet phone-friendly). A bigger overflow fails. Default 40. */
  phoneOverflowMax?: number;
  /** Known issue: skip the console-error check (reason in the comment on the line). */
  skipConsole?: boolean;
  anonymous?: boolean;
};

export const SCREENS: Screen[] = [
  { name: "Overview", path: "/", expect: [/overview|today/i] },
  { name: "Patients", path: "/patients", expect: ["Dr Test One"] },
  { name: "Patient chart", path: "/patients/:patientId", expect: ["E2E-100"], inlineFieldsOk: true },
  { name: "Schedule (list)", path: "/schedule", expect: [/schedule/i, "Dr Test One"], inlineFieldsOk: true },
  { name: "Schedule providers", path: "/schedule/providers", expect: ["Dr Test One"] },
  { name: "Schedule settings", path: "/schedule/settings", expect: [/track|visit type/i] },
  { name: "Schedule import", path: "/schedule/import", expect: [/import/i] },
  { name: "Billing: Encounters", path: "/billing", expect: [/billing/i, "TP"] },
  { name: "Billing: new encounter", path: "/billing/new", expect: [/encounter|patient/i] },
  { name: "Billing: history", path: "/billing/history", expect: [], notFoundOk: true /* needs ?entity=&id=; bare URL is a 404 by design */ },
  { name: "Billing: Incorrect billing", path: "/billing/incorrect", expect: [/incorrect/i] },
  { name: "Billing: Files", path: "/billing/files", expect: ["synthetic-report.csv"] },
  { name: "Billing: GetIX compare", path: "/billing/compare", expect: [/GetIX compare/i] },
  { name: "Billing: patients", path: "/billing/patients", expect: ["E2E-100"] },
  { name: "Billing: programs", path: "/billing/programs", expect: [/program/i] },
  { name: "Reports", path: "/reports", expect: [/report/i] },
  { name: "Tasks", path: "/tasks", expect: [/task/i] },
  { name: "Tasks: analytics", path: "/tasks/analytics", expect: [/task|analytics/i] },
  { name: "Tasks: recurring", path: "/tasks/recurring", expect: ["Weekly synthetic check"], inlineFieldsOk: true },
  { name: "Employees", path: "/employees", expect: ["Alex Tester"], inlineFieldsOk: true },
  { name: "Ledger", path: "/ledger", expect: [/ledger/i, "Synthetic supplies"], inlineFieldsOk: true },
  { name: "Ledger: Summary", path: "/ledger/summary", expect: [/summary/i] },
  { name: "Ledger: Lists", path: "/ledger/settings", expect: ["Supplies"], inlineFieldsOk: true },
  { name: "Notes (now part of Schedule)", path: "/notes", expect: [/schedule/i], redirectsTo: "/schedule", inlineFieldsOk: true },
  { name: "Feedback", path: "/feedback", expect: ["Synthetic feedback 0"] },
  { name: "Settings", path: "/settings", expect: [/settings/i] },
  { name: "Administration", path: "/admin", expect: [/admin/i], redirectsTo: "/admin/task-tabs" },
  { name: "Admin: Users (access, merged into Employees)", path: "/admin/access", expect: ["Alex Tester"], redirectsTo: "/employees", inlineFieldsOk: true },
  { name: "Admin: access review", path: "/admin/access-review", expect: [/review|access/i] },
  { name: "Admin: activity", path: "/admin/activity", expect: [/activity|audit/i] },
  { name: "Admin: API tokens", path: "/admin/api-tokens", expect: [/token/i] },
  { name: "Admin: costs", path: "/admin/costs", expect: [/cost/i] },
  { name: "Admin: diagnostics", path: "/admin/diagnostics", expect: [/diagnos/i] },
  { name: "Admin: Lists", path: "/admin/lists", expect: [/list|visit type/i] },
  { name: "Admin: promote", path: "/admin/promote", expect: [], notFoundOk: true },
  { name: "Admin: task access", path: "/admin/task-access", expect: [/task/i], redirectsTo: "/admin/task-tabs" },
  { name: "Admin: task tabs", path: "/admin/task-tabs", expect: [/task|tab/i] },
  { name: "Admin: timesheets", path: "/admin/timesheets", expect: [/timesheet/i], inlineFieldsOk: true },
  { name: "Download", path: "/download", expect: [/download/i] },
  { name: "Login", path: "/login", expect: [/sign in/i], anonymous: true },
];

/** Pages deliberately not in SCREENS (printable/redirect-only/needs special params), with the reason. */
export const SKIPPED: Record<string, string> = {
  "src/app/schedule/print/page.tsx": "print layout; covered by the schedule list checks",
  "src/app/billing/encounters/[id]/edit/page.tsx": "needs an encounter id; covered by the encounter edit test",
  "src/app/billing/patients/[id]/page.tsx": "needs a patient id; covered by the billing patient test",
  "src/app/denied/page.tsx": "shown only to users without access",
};
