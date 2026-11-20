// Reports (feedback cmwp3o37x003kb4ix7gw7srte, cmwp3o3fe0044b4ix3lhtnqyi). Pure: visits in, tables out. Names are only ever put in a
// column flagged `name`; the redacted export drops those columns (and the Patients report numbers people instead).
export type ReportVisit = {
  id: string; date: string; time: string; status: string; program: string; type: string; provider: string; trackingOnly: boolean;
  patientId: string; patientName: string; chargeCode: string; billed: boolean; hasEncounter: boolean; docCount: number; docDraft: boolean;
};
export type Cell = string | number;
export type Table = { title: string; columns: { key: string; label: string; name?: boolean }[]; rows: Cell[][] };
export type ReportDef = { id: string; label: string; blurb: string };

export const REPORTS: ReportDef[] = [
  { id: "seen", label: "Seen vs Not Seen", blurb: "Counts and share by status, with the visits behind them." },
  { id: "billing", label: "Billing", blurb: "Seen visits that still need billing, and those billed, by charge code." },
  { id: "docs", label: "Missing Docs", blurb: "Seen visits with no documentation, or documentation waiting review." },
  { id: "patients", label: "Patients summary", blurb: "Per patient: appointments, seen, Not Seen split, upcoming, last seen, providers." },
  { id: "types", label: "Visit Types", blurb: "Totals per visit type: seen, not seen, billed, seen but not billed." },
  { id: "providers", label: "Provider productivity", blurb: "Per provider: visits, seen, not seen, billed." },
  { id: "timesheet", label: "Timesheet and invoice data", blurb: "Seen visits per provider for sign-off, and invoice lines by program and charge code. Tracking-only providers are left out." },
];

export const isSeen = (s: string) => s === "seen" || s === "note_signed";
const isNotSeen = (s: string) => s === "no_show" || s === "cancelled" || s === "missed";
const STATUS_LABEL: Record<string, string> = { scheduled: "Scheduled", seen: "Seen", note_signed: "Note signed", no_show: "Not Seen", cancelled: "Cancelled", missed: "Missed", other: "Other" };
export const statusText = (s: string) => STATUS_LABEL[s] ?? "Scheduled";
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
const byDate = (a: ReportVisit, b: ReportVisit) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
const tally = <T,>(items: T[], key: (t: T) => string) => { const m = new Map<string, T[]>(); for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); };

const visitCols = [
  { key: "date", label: "Date" }, { key: "patient", label: "Patient", name: true }, { key: "type", label: "Visit type" },
  { key: "program", label: "Program" }, { key: "provider", label: "Provider" }, { key: "status", label: "Status" },
];
const visitRow = (v: ReportVisit): Cell[] => [v.date, v.patientName, v.type, v.program, v.provider, statusText(v.status)];

export function buildReport(id: string, all: ReportVisit[], opts: { today: string }): Table[] {
  const vs = [...all].sort(byDate);
  switch (id) {
    case "seen": {
      const g = tally(vs, (v) => statusText(v.status));
      return [
        { title: "By status", columns: [{ key: "status", label: "Status" }, { key: "n", label: "Visits" }, { key: "share", label: "Share" }], rows: g.map(([k, l]) => [k, l.length, pct(l.length, vs.length)]) },
        { title: "Visits", columns: visitCols, rows: vs.map(visitRow) },
      ];
    }
    case "billing": {
      const seen = vs.filter((v) => isSeen(v.status) && !v.trackingOnly);
      const code = (v: ReportVisit) => v.chargeCode || "(none)";
      const g = tally(seen, code);
      return [
        { title: "By charge code", columns: [{ key: "c", label: "Charge code" }, { key: "need", label: "Needs billing" }, { key: "done", label: "Billed" }], rows: g.map(([k, l]) => [k, l.filter((v) => !v.billed).length, l.filter((v) => v.billed).length]) },
        { title: "Needs billing", columns: [...visitCols.slice(0, 5), { key: "code", label: "Charge code" }], rows: seen.filter((v) => !v.billed).map((v) => [...visitRow(v).slice(0, 5), v.chargeCode]) },
      ];
    }
    case "docs": {
      const rows = vs.filter((v) => isSeen(v.status) && !v.trackingOnly && (v.docCount === 0 || v.docDraft));
      return [{ title: "Seen visits needing documentation", columns: [...visitCols.slice(0, 5), { key: "d", label: "Documentation" }], rows: rows.map((v) => [...visitRow(v).slice(0, 5), v.docCount === 0 ? "Missing" : "Needs review"]) }];
    }
    case "patients": {
      const g = tally(vs, (v) => v.patientId);
      const rows = g.map(([, l], i) => {
        const names = l[0].patientName;
        const seen = l.filter((v) => isSeen(v.status));
        const upcoming = l.filter((v) => v.status === "scheduled" && v.date >= opts.today).length;
        const provs = tally(seen, (v) => v.provider || "(none)").map(([p, x]) => `${p} ${x.length}`).join("; ");
        return [names, `P-${String(i + 1).padStart(3, "0")}`, l.length, seen.length, l.filter((v) => v.status === "missed").length, l.filter((v) => v.status === "no_show").length, l.filter((v) => v.status === "cancelled").length, l.filter((v) => v.status === "other").length, upcoming, seen.map((v) => v.date).sort().pop() ?? "", provs] as Cell[];
      });
      return [{
        title: "Patients",
        columns: [{ key: "name", label: "Patient", name: true }, { key: "ref", label: "Ref" }, { key: "n", label: "Appointments" }, { key: "seen", label: "Seen" }, { key: "missed", label: "Missed" }, { key: "abs", label: "Not Seen" }, { key: "can", label: "Cancelled" }, { key: "oth", label: "Other" }, { key: "up", label: "Upcoming" }, { key: "last", label: "Last seen" }, { key: "prov", label: "Providers (seen)" }],
        rows,
      }];
    }
    case "types": {
      const rows = tally(vs, (v) => v.type || "(none)").map(([k, l]) => {
        const seen = l.filter((v) => isSeen(v.status));
        return [k, l.length, seen.length, l.filter((v) => isNotSeen(v.status)).length, seen.filter((v) => v.billed).length, seen.filter((v) => !v.billed && !v.trackingOnly).length] as Cell[];
      });
      return [{ title: "By visit type", columns: [{ key: "t", label: "Visit type" }, { key: "n", label: "Total" }, { key: "s", label: "Seen" }, { key: "ns", label: "Not seen" }, { key: "b", label: "Billed" }, { key: "snb", label: "Seen, not billed" }], rows }];
    }
    case "providers": {
      const rows = tally(vs, (v) => v.provider || "(none)").map(([k, l]) => [k, l.length, l.filter((v) => isSeen(v.status)).length, l.filter((v) => isNotSeen(v.status)).length, l.filter((v) => v.billed).length, l[0].trackingOnly ? "tracking only" : ""] as Cell[]);
      return [{ title: "By provider", columns: [{ key: "p", label: "Provider" }, { key: "n", label: "Visits" }, { key: "s", label: "Seen" }, { key: "ns", label: "Not seen" }, { key: "b", label: "Billed" }, { key: "t", label: "" }], rows }];
    }
    case "timesheet": {
      const seen = vs.filter((v) => isSeen(v.status) && !v.trackingOnly);
      const lines = tally(seen, (v) => `${v.program || "(none)"}\u0000${v.chargeCode || "(none)"}`).map(([k, l]) => { const [p, c] = k.split("\u0000"); return [p, c, l.length] as Cell[]; });
      return [
        { title: "Invoice lines (seen visits by program and charge code)", columns: [{ key: "p", label: "Program" }, { key: "c", label: "Charge code" }, { key: "n", label: "Visits" }], rows: [...lines, ["Total", "", seen.length]] },
        { title: "Provider timesheet (seen visits, for sign-off)", columns: [{ key: "pr", label: "Provider" }, { key: "date", label: "Date" }, { key: "time", label: "Time" }, { key: "pt", label: "Patient", name: true }, { key: "ty", label: "Visit type" }, { key: "pg", label: "Program" }, { key: "c", label: "Charge code" }], rows: [...seen].sort((a, b) => a.provider.localeCompare(b.provider) || byDate(a, b)).map((v) => [v.provider || "(none)", v.date, v.time, v.patientName, v.type, v.program, v.chargeCode]) },
      ];
    }
    default: return [];
  }
}

/** Drops name columns when the viewer may not see names or a redacted export is asked for. */
export function redact(tables: Table[]): Table[] {
  return tables.map((t) => {
    const keep = t.columns.map((c) => !c.name);
    return { ...t, columns: t.columns.filter((_, i) => keep[i]), rows: t.rows.map((r) => r.filter((_, i) => keep[i])) };
  });
}

const csvCell = (v: Cell) => { const s = String(v); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export function toCsv(tables: Table[]): string {
  return tables.map((t) => [csvCell(t.title), t.columns.map((c) => csvCell(c.label)).join(","), ...t.rows.map((r) => r.map(csvCell).join(","))].join("\n")).join("\n\n") + "\n";
}
