// Feedback cmwlchiji: visits that share a program and a time (a track block like KIOP-AM 9:00-11:30) are shown inside one coloured
// group container that lists everyone in it. Pure; the order of the day (sortRows) is kept, a group sits where its first visit is.
export const GROUP_COLORS = ["#7c5cbf", "#2f7d6b", "#b5651d", "#2b6cb0", "#a23b5a", "#6b7280"] as const;

export type VisitGroup<T> = { key: string | null; program: string; time: string; color: string; rows: T[] };

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function groupVisits<T extends { program: string; apptTime: string }>(visits: T[]): VisitGroup<T>[] {
  const keyOf = (v: T) => (v.program.trim() && v.apptTime.trim() ? `${norm(v.program)}|${norm(v.apptTime)}` : null);
  const counts = new Map<string, number>();
  for (const v of visits) { const k = keyOf(v); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  const out: VisitGroup<T>[] = [];
  const byKey = new Map<string, VisitGroup<T>>();
  const colorOfProgram = new Map<string, string>();
  for (const v of visits) {
    const k = keyOf(v);
    if (!k || (counts.get(k) ?? 0) < 2) { out.push({ key: null, program: v.program, time: v.apptTime, color: "", rows: [v] }); continue; }
    let g = byKey.get(k);
    if (!g) {
      const p = norm(v.program);
      if (!colorOfProgram.has(p)) colorOfProgram.set(p, GROUP_COLORS[colorOfProgram.size % GROUP_COLORS.length]);
      g = { key: k, program: v.program, time: v.apptTime, color: colorOfProgram.get(p)!, rows: [] };
      byKey.set(k, g);
      out.push(g);
    }
    g.rows.push(v);
  }
  return out;
}
