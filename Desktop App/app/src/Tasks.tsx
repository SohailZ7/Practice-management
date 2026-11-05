import { useCallback, useEffect, useState } from "react";
import { createTask, fetchTasks, SignedOutError, taskErrorMessage, updateTask, type Session, type Task } from "./lib/api";

const FILTERS = ["open", "done", "all"] as const;
type Filter = (typeof FILTERS)[number];

/** My tasks: open/done filter, quick add (title and an optional due date), and mark done or open again. */
export function Tasks({ session, onSignedOut }: { session: Session; onSignedOut: () => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => { if (e instanceof SignedOutError) onSignedOut(); else setError(taskErrorMessage(e)); };

  const load = useCallback(async () => {
    try { setTasks((await fetchTasks(session, filter)).tasks); setError(""); } catch (e) { setTasks([]); fail(e); }
  }, [session.baseUrl, session.accessToken, filter]);

  useEffect(() => { setTasks(null); void load(); }, [load]);

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>My tasks</h2>
      <div className="row" style={{ marginBottom: ".6rem" }}>
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? "" : "secondary"} onClick={() => setFilter(f)}>
            {f === "open" ? "Open" : f === "done" ? "Done" : "All"}
          </button>
        ))}
        <span className="grow" />
        <button className="secondary" onClick={() => void load()}>Refresh</button>
      </div>

      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) { setError("Give the task a title."); return; }
        setBusy(true);
        try { await createTask(session, title.trim(), due || undefined); setTitle(""); setDue(""); await load(); }
        catch (err) { fail(err); } finally { setBusy(false); }
      }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task" aria-label="Task title" style={{ flex: 1 }} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date (optional)" />
        <button disabled={busy}>Add</button>
      </form>
      {error && <p className="small err">{error}</p>}

      {tasks === null ? <p className="small">Loading…</p> : tasks.length === 0 ? <p className="small">No {filter === "all" ? "" : filter + " "}tasks.</p> : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: ".8rem" }}>
          {tasks.map((t) => (
            <li key={t.id} className="row" style={{ padding: ".3rem 0", borderBottom: "1px solid var(--line, #ddd)" }}>
              <input
                type="checkbox" checked={t.status === "done"} aria-label={`Mark "${t.title}" ${t.status === "done" ? "open" : "done"}`}
                onChange={async (e) => {
                  try { await updateTask(session, t.id, { status: e.target.checked ? "done" : "open" }); await load(); } catch (err) { fail(err); }
                }}
              />
              <span style={{ flex: 1, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</span>
              {t.dueDate && <span className="small">due {t.dueDate}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="small">Recurring tasks are managed in the web app.</p>
    </div>
  );
}
