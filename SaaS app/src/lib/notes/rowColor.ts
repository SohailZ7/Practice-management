// Schedule row colours and the OVERDUE flag (feedback cmwp3o3iy004eb4ix3ba69a8i). Pure.
// white = not marked yet; gray = not seen (Not Seen, Cancelled, Missed); yellow = seen, no documentation yet;
// blue = seen, a document waits for review; green = seen, documents reviewed. Outside (tracking-only) providers keep their charcoal row.
export type RowTone = "white" | "gray" | "yellow" | "blue" | "green";

export function rowTone(v: { status: string; docCount: number; hasDraft: boolean }): RowTone {
  if (v.status === "seen" || v.status === "note_signed") {
    if (v.docCount === 0) return "yellow";
    return v.hasDraft ? "blue" : "green";
  }
  if (v.status === "no_show" || v.status === "cancelled" || v.status === "missed") return "gray";
  return "white";
}

export const OVERDUE_DAYS = 7;

const dayNumber = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000) : null;
};

/** A visit not completed (still Scheduled or Other) more than 7 days after its date is overdue (Fairfax contract). */
export function isOverdue(visitDate: string, status: string, today: string): boolean {
  if (status !== "scheduled" && status !== "other") return false;
  const a = dayNumber(visitDate); const b = dayNumber(today);
  return a !== null && b !== null && b - a > OVERDUE_DAYS;
}

/** Today's date in the practice time zone, YYYY-MM-DD. */
export const practiceToday = (now: Date = new Date()): string => now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
