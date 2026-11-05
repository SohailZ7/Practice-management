// Parses a day's board pasted from the practice's Excel sheet (change request 4).
//
// The paste is tab-separated, one row per line. Columns shift a little between the Psych Eval block, the Track block and
// the "Orders Only" block, so the parser reads a header row when it finds one and falls back to fixed positions.
// Anything that is not a real appointment is dropped: placeholder rows ("Select Time", "Select Track"), rows with no
// client, repeated header rows, and the treatment-team and inpatient blocks.

import type { ScheduleItem } from "./types";

export type ParseResult = {
  entries: ScheduleItem[];
  /** Counts shown to the user, so a bad paste is obvious rather than silent. */
  summary: { lines: number; kept: number; skippedNoClient: number; skippedOtherProvider: number; skippedPlaceholder: number };
  otherProviders: string[];
};

const PLACEHOLDER = /^(select\s+(time|type|track|provider|order|option)|tracks?|type|client\s*info|time|date|absent|canceled|completed|missed|sent to team|column\d*|orders only no follow ups|treatment|teams)$/i;

const clean = (v: string) => v.replace(/ /g, " ").replace(/\s+/g, " ").trim();
const isPlaceholder = (v: string) => !v || PLACEHOLDER.test(v);
const truthy = (v: string) => /^(true|yes|x)$/i.test(clean(v));

/** "Lucas Scotta/39M/BCBS/SD from W2 to KIOP PM2" gives the name plus the rest, which is kept for display only. */
export function parseClient(raw: string): { lastName: string; firstName: string; detail: string } | null {
  let text = clean(raw).replace(/^["']|["']$/g, "");
  if (!text || isPlaceholder(text)) return null;
  // A trailing "DC 10/21" note is not part of the name, and must go before the "/" split or the date splits the name.
  text = text.replace(/\s+(DC|D\/C)\b[\s:]*\d{0,2}[/-]?\d{0,2}\s*$/i, "").trim();
  const [namePart, ...rest] = text.split("/");
  const name = clean(namePart);
  if (!name) return null;
  const detail = rest.map(clean).map(withoutAge).filter(Boolean).join(" / ");

  if (name.includes(",")) {
    const [last, first] = name.split(",");
    return { lastName: clean(last), firstName: clean(first), detail };
  }
  // Drop a quoted nickname: Thu "Alex" Nguyen becomes Thu Nguyen.
  const parts = name.replace(/["“][^"”]*["”]/g, " ").split(/\s+/).map(clean).filter(Boolean);
  if (parts.length === 1) return { lastName: parts[0], firstName: "", detail };
  return { lastName: parts[parts.length - 1], firstName: parts.slice(0, -1).join(" "), detail };
}

/**
 * Drops the patient's age from a detail segment (owner's request). The sheet writes age and sex together as one
 * token ("40F", "33FTM"), so the digits go and the sex is kept; a segment that is only an age disappears.
 * The age is removed here, at parse time, so it is never stored in the saved schedule either.
 */
export function withoutAge(segment: string): string {
  const m = /^(\d{1,3})\s*([A-Za-z]{1,4})?$/.exec(segment.trim());
  if (!m) return segment;
  return m[2] ?? "";
}

/** The program shown on the board: the track name for a track row, otherwise the program from the type column. */
function programOf(time: string, type: string): string {
  const t = clean(time);
  const track = /^([A-Z][A-Z0-9&-]*(?:-[A-Z0-9]+)?(?:\s*\d*\s*hr)?)\s+\d/.exec(t);
  if (track) return clean(track[1]);
  if (/psych eval/i.test(t) || /psych eval/i.test(type)) return "Psych Eval";
  if (/dc orders/i.test(t)) return "Discharge orders";
  return clean(type) || clean(t);
}

/** The appointment type: the Type column for a track row, the Time column for a Psych Eval or orders row. */
function appointmentType(time: string, type: string): string {
  const t = clean(time);
  if (/psych eval|dc orders|h&p/i.test(t)) return t.replace(/^\s*\d{1,2}:\d{2}\s*:?\s*/, "").trim();
  return clean(type);
}

/**
 * The appointment time as written in the sheet's time cell: "2:00" from "2:00: Psych Eval & Admit Order", or
 * "9:00-11:30" from "KIOP-AM  9:00 - 11:30". Empty when the cell holds no clock time ("Select Time").
 */
export function apptTimeOf(time: string): string {
  const m = /(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?/.exec(clean(time));
  if (!m) return "";
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

const HEADER_HINTS = ["time", "tracks", "type", "client info", "absent", "canceled", "provider", "completed", "missed"];

function columnsFrom(cells: string[]): Record<string, number> | null {
  const lower = cells.map((c) => clean(c).toLowerCase());
  if (!lower.includes("client info") || !lower.includes("provider")) return null;
  const idx: Record<string, number> = {};
  lower.forEach((c, i) => {
    if (c === "time" || c === "tracks" || c === "track") idx.time ??= i;
    else if (c === "type") idx.type ??= i;
    else if (c === "client info") idx.client = i;
    else if (c === "provider") idx.provider = i;
    else if (c === "absent") idx.absent = i;
    else if (c === "canceled" || c === "cancelled") idx.canceled = i;
    else if (c === "completed" || c === "complete") idx.completed = i;
    else if (c === "missed") idx.missed = i;
  });
  return idx;
}

const DEFAULT_COLUMNS = { time: 0, type: 1, client: 2, absent: 3, canceled: 4, provider: 5, completed: 6, missed: 7 };

/**
 * `provider` is the name whose rows to keep, matched loosely so "Dr. Khalid Ahmed" matches "Dr Khalid Ahmed ".
 * An empty string keeps every row.
 */
export function parseSchedule(text: string, provider: string): ParseResult {
  const wanted = clean(provider).toLowerCase().replace(/^dr\.?\s+/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let cols: Record<string, number> = { ...DEFAULT_COLUMNS };
  let sawHeader = false;
  const entries: ScheduleItem[] = [];
  const others = new Set<string>();
  const summary = { lines: lines.length, kept: 0, skippedNoClient: 0, skippedOtherProvider: 0, skippedPlaceholder: 0 };

  for (const [i, line] of lines.entries()) {
    const cells = line.split("\t");
    // Before any header row is seen, a leading date column ("Wednesday 10/28", or blank on the other rows of that day)
    // shifts every column by one. Once a header is found its positions are authoritative and nothing is shifted.
    if (!sawHeader && cells.length > 8 && /^([A-Za-z]+day\s+\d{1,2}\/\d{1,2}.*)?$/.test(clean(cells[0]))) cells.shift();

    const header = columnsFrom(cells);
    if (header) {
      cols = { ...DEFAULT_COLUMNS, ...header };
      sawHeader = true;
      summary.skippedPlaceholder += 1;
      continue;
    }
    const at = (k: keyof typeof DEFAULT_COLUMNS) => clean(cells[cols[k] ?? DEFAULT_COLUMNS[k]] ?? "");
    const lowerCells = cells.map((c) => clean(c).toLowerCase());
    if (HEADER_HINTS.filter((h) => lowerCells.includes(h)).length >= 3) {
      summary.skippedPlaceholder += 1;
      continue;
    }

    const patient = parseClient(at("client"));
    if (!patient) {
      summary.skippedNoClient += 1;
      continue;
    }
    const providerName = at("provider");
    if (isPlaceholder(providerName) || /inpatient team/i.test(providerName)) {
      summary.skippedOtherProvider += 1;
      continue;
    }
    const normalized = providerName.toLowerCase().replace(/^dr\.?\s+/, "");
    if (wanted && normalized !== wanted) {
      others.add(providerName);
      summary.skippedOtherProvider += 1;
      continue;
    }

    const time = at("time");
    const type = appointmentType(time, at("type"));
    if (isPlaceholder(type) && isPlaceholder(time)) {
      summary.skippedPlaceholder += 1;
      continue;
    }

    entries.push({
      id: `p${i}`,
      time,
      apptTime: apptTimeOf(time),
      program: programOf(time, at("type")),
      type,
      provider: { id: null, name: providerName },
      status: { absent: truthy(at("absent")), canceled: truthy(at("canceled")), completed: truthy(at("completed")), missed: truthy(at("missed")) },
      patient: { id: `${patient.lastName}|${patient.firstName}`, lastName: patient.lastName, firstName: patient.firstName },
      clientInfo: patient.detail,
      consent: "unlinked",
    });
    summary.kept += 1;
  }
  return { entries, summary, otherProviders: [...others].sort() };
}
