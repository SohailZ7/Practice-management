// Patients tab (phase 0): one row per patient, derived from the existing Visit and ScheduleEntry rows. Pure functions, no database,
// so the counts are testable. An appointment is a live Visit, or a ScheduleEntry for the patient that no Visit mirrors.

export type VisitIn = { patientId: string; date: string; status: string; provider: string; program: string; type: string };
export type EntryIn = { patientId: string; date: string; completed: boolean; absent: boolean; canceled: boolean; missed: boolean; provider: string; program: string; type: string };

export type Outcome = "seen" | "absent" | "missed" | "canceled" | "other" | "upcoming" | "unmarked";

/** What happened to one appointment, by date. Cancelled beats no-show beats missed beats seen; past with no mark = unmarked. */
export function outcome(flags: { completed: boolean; absent: boolean; canceled: boolean; missed: boolean; other?: boolean }, date: string, today: string): Outcome {
  if (flags.other) return "other";
  if (flags.canceled) return "canceled";
  if (flags.absent) return "absent";
  if (flags.missed) return "missed";
  if (flags.completed) return "seen";
  return date >= today ? "upcoming" : "unmarked";
}

const visitFlags = (status: string) => ({ completed: status === "seen" || status === "note_signed", absent: status === "no_show", canceled: status === "cancelled", missed: status === "missed", other: status === "other" });

export type PatientRollup = {
  patientId: string;
  appointments: number; seen: number; absent: number; missed: number; canceled: number; other: number; upcoming: number; unmarked: number;
  lastSeen: string; lastProvider: string; currentProgram: string;
  providers: { name: string; visits: number }[];
  visitTypes: string[];
};

export function rollup(visits: VisitIn[], entries: EntryIn[], today: string): Map<string, PatientRollup> {
  const out = new Map<string, PatientRollup>();
  const provCount = new Map<string, Map<string, number>>();
  const types = new Map<string, Set<string>>();
  const latest = new Map<string, string>(); // patientId -> latest appointment date, for program
  const add = (patientId: string, date: string, o: Outcome, provider: string, program: string, type: string) => {
    let r = out.get(patientId);
    if (!r) {
      r = { patientId, appointments: 0, seen: 0, absent: 0, missed: 0, canceled: 0, other: 0, upcoming: 0, unmarked: 0, lastSeen: "", lastProvider: "", currentProgram: "", providers: [], visitTypes: [] };
      out.set(patientId, r);
    }
    r.appointments++; r[o]++;
    if (o === "seen") {
      if (date > r.lastSeen) { r.lastSeen = date; r.lastProvider = provider; }
      if (provider) {
        const m = provCount.get(patientId) ?? new Map<string, number>();
        m.set(provider, (m.get(provider) ?? 0) + 1); provCount.set(patientId, m);
      }
      if (type) { const s = types.get(patientId) ?? new Set<string>(); s.add(type); types.set(patientId, s); }
    }
    if (program && date >= (latest.get(patientId) ?? "")) { latest.set(patientId, date); r.currentProgram = program; }
  };
  for (const v of visits) add(v.patientId, v.date, outcome(visitFlags(v.status), v.date, today), v.provider, v.program, v.type);
  for (const e of entries) add(e.patientId, e.date, outcome(e, e.date, today), e.provider, e.program, e.type);
  for (const [id, r] of out) {
    r.providers = [...(provCount.get(id) ?? [])].map(([name, visits]) => ({ name, visits })).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
    r.visitTypes = [...(types.get(id) ?? [])].sort();
  }
  return out;
}
