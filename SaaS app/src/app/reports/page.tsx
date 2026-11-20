import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";

// Reports: its own menu item (not inside Tasks analytics). The report pages are built one release at a time (phase 4);
// this page lists them so nothing is hidden. Names in a report need Patients (notes) view; every report gets a redacted export.
const REPORTS = [
  "Seen vs Not Seen",
  "Billing (Needs Billing vs Billed, by charge code)",
  "Missing Docs",
  "Patients summary (seen, Missed, Absent, Canceled, Other, upcoming, last seen, providers)",
  "Visit Types (totals, seen, not seen, billed, seen-not-billed)",
  "Provider productivity",
  "Timesheet and invoice data",
  "Redacted charge export (no patient names)",
];

export default async function Reports() {
  const user = await requireAccess("billing", "view");
  await audit(user.email, "reports.view", "landing");
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-eyebrow">Clinical</p>
          <h1>Reports</h1>
          <p className="muted">Action lists with a From/To filter, drill-down and export. Each one is released separately; none is available yet.</p>
        </div>
      </div>
      <table>
        <thead><tr><th>Report</th><th>Status</th></tr></thead>
        <tbody>
          {REPORTS.map((r) => (<tr key={r}><td>{r}</td><td className="muted">Not built yet</td></tr>))}
        </tbody>
      </table>
    </>
  );
}
