// Appointment times: the 15-minute slots offered in the pick list, and a strict check for anything typed.

/** "6:00 AM", "6:15 AM", ... "8:00 PM". */
export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 20 * 60; m += 15) {
    const h24 = Math.floor(m / 60);
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    out.push(`${h}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`);
  }
  return out;
})();

const ONE = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?(m)?\.?$/i;

function one(raw: string): string | null {
  const m = ONE.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const mer = m[3] ? m[3].toUpperCase() : "";
  if (m[3] && !m[4] && /[ap]/i.test(m[3]) && raw.trim().match(/[ap]$/i) === null) return null;
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    return `${h}:${String(min).padStart(2, "0")} ${mer}M`;
  }
  if (m[2] === undefined) return null; // a bare number is not a time
  if (h > 23) return null;
  if (h >= 13) return `${h - 12}:${String(min).padStart(2, "0")} PM`; // 24-hour input
  if (h === 0) return `12:${String(min).padStart(2, "0")} AM`;
  return `${h}:${String(min).padStart(2, "0")}`; // as typed, no AM/PM given
}

/**
 * A time or a range ("9:00 - 11:30") as the practice app accepts it. Returns the cleaned text, or null when what was
 * typed is not a time. Empty input is valid and returns "".
 */
export function normalizeTime(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "";
  const parts = t.split(/\s*-\s*/);
  if (parts.length > 2) return null;
  const cleaned = parts.map(one);
  if (cleaned.some((c) => c === null)) return null;
  return cleaned.join("-");
}
