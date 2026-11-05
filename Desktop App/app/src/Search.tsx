import { useState } from "react";
import { NoteDialog } from "./NoteDialog";
import { TranscriptDialog } from "./TranscriptDialog";
import { searchErrorMessage, searchInputProblem, searchVisits, SignedOutError, type Session, type Visit, type VisitHit } from "./lib/api";
import type { Engine } from "./lib/engine";

/** The search hit as the Visit shape the viewers expect. Nothing beyond the search fields is carried over. */
const asVisit = (h: VisitHit): Visit => ({
  id: h.id, initials: h.initials, program: h.program, apptTime: h.time, appointmentType: h.type, providerName: h.provider,
  hasTranscript: h.hasTranscript, documentCount: h.hasDocuments ? 1 : 0,
});

/** Look a visit up by the patient's initials and/or date, then open its transcript or note read-only. */
export function Search({ engine, session, onSignedOut }: { engine: Engine; session: Session; onSignedOut: () => void }) {
  const [initials, setInitials] = useState("");
  const [date, setDate] = useState("");
  const [hits, setHits] = useState<VisitHit[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ hit: VisitHit; kind: "transcript" | "note" } | null>(null);

  async function run() {
    const problem = searchInputProblem(initials, date);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      setHits((await searchVisits(session, { initials: initials.trim().toUpperCase() || undefined, date: date || undefined })).visits);
    } catch (e) {
      setHits(null);
      if (e instanceof SignedOutError) onSignedOut(); else setError(searchErrorMessage(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <h2 style={{ marginTop: 0 }}>Find a visit</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input value={initials} onChange={(e) => setInitials(e.target.value)} placeholder="Initials (AB)" aria-label="Patient initials" size={12} maxLength={8} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <button disabled={busy}>{busy ? "Searching…" : "Search"}</button>
        <button type="button" className="secondary" onClick={() => { setInitials(""); setDate(""); setHits(null); setError(""); }}>Clear</button>
      </form>
      <p className="small">Enter initials, a date, or both. Newest first, up to 50.</p>
      {error && <p className="small err">{error}</p>}
      {hits !== null && hits.length === 0 && !error && <p className="small">No visits found.</p>}
      {hits !== null && hits.length > 0 && (
        <table className="board">
          <thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Program</th><th>Type</th><th>Provider</th><th /></tr></thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id}>
                <td>{h.date}</td><td>{h.time}</td><td>{h.initials}</td><td>{h.program}</td><td>{h.type}</td><td>{h.provider}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="secondary" disabled={!h.hasTranscript} title={h.hasTranscript ? "Read the transcript" : "No transcript"} onClick={() => setOpen({ hit: h, kind: "transcript" })}>Transcript</button>
                  <button className="secondary" disabled={!h.hasDocuments} title={h.hasDocuments ? "Read the note" : "No note"} onClick={() => setOpen({ hit: h, kind: "note" })}>Note</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open?.kind === "transcript" && (
        <TranscriptDialog visit={asVisit(open.hit)} date={open.hit.date} status={{ phase: "idle" }} queueItem={undefined} queued={false}
          engine={engine} session={session} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "note" && <NoteDialog visit={asVisit(open.hit)} date={open.hit.date} session={session} onClose={() => setOpen(null)} />}
    </div>
  );
}
