// Parser for the "Outpatient Board" worksheet layout (sheet "Doc& HP ..." in the practice workbook).
//
// Layout it understands:
//   - A providers table: a header row containing "Providers" plus optional columns for
//     contact #, NPI #, Zoom ID, Password, Schedule. One provider per row below it.
//   - A board header row containing "Date" and "Time" (plus Type, Client Info, Absent,
//     Canceled, Provider, Completed, Missed).
//   - Day blocks: the date sits in the first row of a block (a merged cell in the source file),
//     followed by Psych Eval rows, then a "Tracks" sub-header, then Track rows.
//
// The parser works on a plain 2D grid so it can be tested without Excel files.

import { excelSerialToISO, isISODate } from "../dates";
import { phi } from "../crypto/phi";

export type Grid = unknown[][];

export type ParsedProvider = {
  name: string;
  contact: string;
  npi: string;
  zoomLink: string;
  zoomPassword: string;
  hours: string;
};

export type ParsedEntry = {
  date: string;
  section: "PSYCH_EVAL" | "TRACK";
  timeLabel: string;
  trackName: string;
  typeName: string;
  clientInfo: string;
  providerName: string;
  absent: boolean;
  canceled: boolean;
  completed: boolean;
  missed: boolean;
  dedupeKey: string;
};

export type ParseResult = {
  providers: ParsedProvider[];
  entries: ParsedEntry[];
  skipped: number;
  warnings: string[];
};

const TIME_RANGE_AT_END = /\s*\d{1,2}(:\d{2})?\s*-\s*\d{1,2}(:\d{2})?\s*$/;

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

function isPlaceholder(text: string): boolean {
  return /^select\b/i.test(text);
}

function truthy(value: unknown): boolean {
  if (typeof value === "number") return value > 0;
  if (typeof value === "boolean") return value;
  const t = cellText(value).toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "y" || t === "x";
}

/** Accepts Excel serials, Date objects, ISO strings and M/D/YYYY strings. */
export function parseDateCell(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Plausible Excel serial range: 2000-01-01 .. 2100-01-01.
    return value >= 36526 && value <= 73415 ? excelSerialToISO(value) : null;
  }
  const t = cellText(value);
  if (/^\d{5}$/.test(t)) return parseDateCell(Number(t));
  if (isISODate(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const iso = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return isISODate(iso) ? iso : null;
  }
  return null;
}

export function normalizeKeyPart(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function makeDedupeKey(e: {
  date: string;
  section: string;
  timeLabel: string;
  providerName: string;
  clientInfo: string;
}, digest: (text: string) => string = (t) => phi().digest(t)): string {
  // The client text never reaches the database: only a keyed HMAC of it does ("h1:" + 43 chars), so duplicates are
  // still recognised (same text -> same digest) but the key reveals nothing without the secret.
  const plain = [e.date, e.section, e.timeLabel, e.providerName].map(normalizeKeyPart);
  return [...plain, `h1:${digest(normalizeKeyPart(e.clientInfo))}`].join("|");
}

/** The key format used before client text was hashed. Only the rollback path of db:encrypt-phi needs it. */
export function legacyDedupeKey(e: { date: string; section: string; timeLabel: string; providerName: string; clientInfo: string }): string {
  return [e.date, e.section, e.timeLabel, e.providerName, e.clientInfo].map(normalizeKeyPart).join("|");
}

type ColumnMap = Record<string, number>;

function findHeaderRow(grid: Grid, test: (cells: string[]) => boolean, from = 0): number {
  for (let r = from; r < grid.length; r++) {
    const cells = (grid[r] ?? []).map((c) => cellText(c).toLowerCase());
    if (test(cells)) return r;
  }
  return -1;
}

function mapColumns(cells: string[], patterns: Record<string, RegExp>): ColumnMap {
  const map: ColumnMap = {};
  cells.forEach((text, idx) => {
    for (const [key, re] of Object.entries(patterns)) {
      if (map[key] === undefined && re.test(text)) map[key] = idx;
    }
  });
  return map;
}

export function parseOutpatientBoard(grid: Grid): ParseResult {
  const warnings: string[] = [];
  const result: ParseResult = { providers: [], entries: [], skipped: 0, warnings };

  const boardRow = findHeaderRow(
    grid,
    (cells) => cells.includes("date") && cells.some((c) => c === "time" || c.startsWith("time ")),
  );
  if (boardRow < 0) {
    warnings.push('Could not find the board header row (a row containing "Date" and "Time").');
    return result;
  }

  // Providers table (optional), above the board header.
  const provRow = findHeaderRow(grid.slice(0, boardRow), (cells) => cells.includes("providers"));
  if (provRow >= 0) {
    const cells = (grid[provRow] ?? []).map((c) => cellText(c).toLowerCase());
    const cols = mapColumns(cells, {
      name: /^providers$/,
      contact: /contact/,
      npi: /npi/,
      zoomLink: /zoom/,
      zoomPassword: /password/,
      hours: /^schedule/,
    });
    for (let r = provRow + 1; r < boardRow; r++) {
      const row = grid[r] ?? [];
      const name = cellText(row[cols.name]);
      if (!name) continue;
      const get = (k: string) => (cols[k] === undefined ? "" : cellText(row[cols[k]]));
      const password = get("zoomPassword");
      result.providers.push({
        name,
        contact: get("contact"),
        npi: get("npi"),
        zoomLink: get("zoomLink"),
        zoomPassword: /^none$/i.test(password) ? "" : password,
        hours: get("hours"),
      });
    }
  }

  const headerCells = (grid[boardRow] ?? []).map((c) => cellText(c).toLowerCase());
  const cols = mapColumns(headerCells, {
    date: /^date/,
    time: /^time/,
    type: /^type/,
    client: /client/,
    absent: /^absent/,
    canceled: /cancel/,
    provider: /^provider/,
    completed: /^complete/,
    missed: /^missed/,
  });
  for (const required of ["date", "time", "client"]) {
    if (cols[required] === undefined) {
      warnings.push(`Board header is missing the "${required}" column.`);
      return result;
    }
  }

  let currentDate: string | null = null;
  let section: "PSYCH_EVAL" | "TRACK" = "PSYCH_EVAL";
  const seen = new Set<string>();

  for (let r = boardRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const rowNumber = r + 1;
    const dateValue = row[cols.date];
    const time = cellText(row[cols.time]);
    const type = cols.type === undefined ? "" : cellText(row[cols.type]);
    const client = cellText(row[cols.client]);

    if (cellText(dateValue).toLowerCase() === "date") continue; // repeated header

    if (cellText(dateValue)) {
      const parsed = parseDateCell(dateValue);
      if (parsed) {
        // Merged date cells repeat on every row of a block; only a changed date starts a new block.
        if (parsed !== currentDate) section = "PSYCH_EVAL";
        currentDate = parsed;
      } else {
        warnings.push(`Row ${rowNumber}: could not read date "${cellText(dateValue)}".`);
        currentDate = null;
      }
    }

    if (time.toLowerCase() === "tracks") {
      section = "TRACK";
      continue;
    }

    if (!time && !type && !client) continue; // blank row

    if (!client || isPlaceholder(client)) {
      result.skipped++; // empty template slot
      continue;
    }
    if (!currentDate) {
      warnings.push(`Row ${rowNumber}: no date for this row, skipped.`);
      result.skipped++;
      continue;
    }

    const timeLabel = isPlaceholder(time) ? "" : time;
    const rawProvider = cols.provider === undefined ? "" : cellText(row[cols.provider]);
    const entry: ParsedEntry = {
      date: currentDate,
      section,
      timeLabel,
      trackName: section === "TRACK" ? timeLabel.replace(TIME_RANGE_AT_END, "").trim() : "",
      typeName: isPlaceholder(type) ? "" : type,
      clientInfo: client,
      providerName: isPlaceholder(rawProvider) ? "" : rawProvider,
      absent: cols.absent !== undefined && truthy(row[cols.absent]),
      canceled: cols.canceled !== undefined && truthy(row[cols.canceled]),
      completed: cols.completed !== undefined && truthy(row[cols.completed]),
      missed: cols.missed !== undefined && truthy(row[cols.missed]),
      dedupeKey: "",
    };
    entry.dedupeKey = makeDedupeKey(entry);
    if (seen.has(entry.dedupeKey)) {
      warnings.push(`Row ${rowNumber}: identical to an earlier row in this sheet, skipped.`);
      result.skipped++;
      continue;
    }
    seen.add(entry.dedupeKey);
    result.entries.push(entry);
  }

  return result;
}
