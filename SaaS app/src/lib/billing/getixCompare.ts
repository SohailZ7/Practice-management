// GetIX report compare (feedback cmwp3o3bw003ub4ixsfcmydwl). Pure: parse a pasted/uploaded CSV report, match to encounters by date and patient.
export type ReportRow = { date: string; key: string; display: string; chargeCode: string };
export type EncRow = { id: string; date: string; key: string; display: string; chargeCode: string; incorrect: boolean };

/** Split one CSV line, honouring double quotes. */
export function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === "," || c === "\t") { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** YYYY-MM-DD from 2026-11-05, 11/5/2026, 11/5/26. Null if not a date. */
export function normDate(raw: string): string | null {
  const t = raw.trim().split(/[ T]/)[0];
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** Order-free name key: "Doe, Jane", "Jane Doe" and "DOE JANE" match. */
export function nameKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
}

export function parseGetixReport(text: string): { rows: ReportRow[]; error: string | null; skipped: number } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], error: "The report needs a header row and at least one data row.", skipped: 0 };
  const head = splitCsv(lines[0]).map((h) => h.toLowerCase());
  const find = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iDate = find(/date|dos|service/);
  const iFirst = find(/first/);
  const iLast = find(/last/);
  const iName = find(/patient|client|name/);
  const iCode = find(/charge|cpt|code|service code/);
  if (iDate < 0) return { rows: [], error: "No date column found. The header should have a Date or Service Date column.", skipped: 0 };
  if (iName < 0 && (iFirst < 0 || iLast < 0)) return { rows: [], error: "No patient column found. The header should have Patient (or First and Last name).", skipped: 0 };
  const rows: ReportRow[] = []; let skipped = 0;
  for (const l of lines.slice(1)) {
    const c = splitCsv(l);
    const date = normDate(c[iDate] ?? "");
    const display = iName >= 0 && !(iFirst >= 0 && iLast >= 0 && iName === iFirst) ? (c[iName] ?? "") : `${c[iFirst] ?? ""} ${c[iLast] ?? ""}`;
    if (!date || !display.trim()) { skipped++; continue; }
    rows.push({ date, key: nameKey(display), display: display.trim(), chargeCode: iCode >= 0 ? (c[iCode] ?? "") : "" });
  }
  return { rows, error: rows.length ? null : "No usable rows found (each needs a date and a patient).", skipped };
}

export type CompareResult = {
  from: string; to: string; matched: number;
  onlyInReport: ReportRow[];
  onlyInApp: EncRow[];
  incorrectStillInReport: EncRow[];
};

/** Encounters here are those marked entered in GetIX (NB DC is never entered there) and not deleted. */
export function compareGetix(report: ReportRow[], encounters: EncRow[]): CompareResult {
  const dates = report.map((r) => r.date).sort();
  const from = dates[0] ?? ""; const to = dates[dates.length - 1] ?? "";
  const pool = new Map<string, EncRow[]>();
  for (const e of encounters) { if (e.date < from || e.date > to) continue; const k = `${e.date}|${e.key}`; pool.set(k, [...(pool.get(k) ?? []), e]); }
  const used = new Set<string>();
  const onlyInReport: ReportRow[] = []; const incorrectStillInReport: EncRow[] = [];
  let matched = 0;
  for (const r of report) {
    const list = pool.get(`${r.date}|${r.key}`) ?? [];
    const hit = list.find((e) => !used.has(e.id) && !e.incorrect) ?? list.find((e) => !used.has(e.id));
    if (!hit) { onlyInReport.push(r); continue; }
    used.add(hit.id);
    if (hit.incorrect) incorrectStillInReport.push(hit); else matched++;
  }
  const onlyInApp = encounters.filter((e) => e.date >= from && e.date <= to && !e.incorrect && !used.has(e.id));
  return { from, to, matched, onlyInReport, onlyInApp, incorrectStillInReport };
}
