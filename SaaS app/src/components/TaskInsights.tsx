"use client";

import { boardColumns, progressLine, taskProgress } from "@/lib/taskInsights";
import type { CategoryDTO, TaskDTO } from "@/lib/taskTypes";

export type Workload = { id: string; name: string; open: number };

/** The two side panels from the Tasks board: today's progress and everyone's open work. */
export function TaskInsights({ tasks, today, tz, workload }: { tasks: TaskDTO[]; today: string; tz?: string; workload: Workload[] }) {
  const p = taskProgress(tasks, today, tz);
  const max = Math.max(1, ...workload.map((w) => w.open));
  return (
    <aside className="task-insights" aria-label="Progress and workload">
      <section className="ti-card">
        <h3>A little progress, every day</h3>
        <div className="ti-big"><b>{p.doneToday}</b> <span>/ {p.total}</span></div>
        <div className="ti-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-label="Finished today"><i style={{ width: `${p.pct}%` }} /></div>
        <p className="small muted">{progressLine(p)}</p>
      </section>
      {workload.length > 0 && (
        <section className="ti-card">
          <h3>Workload at a glance</h3>
          <ul className="ti-load">
            {workload.map((w) => (
              <li key={w.id}>
                <span>{w.name}</span>
                <span className="ti-track"><i style={{ width: `${(w.open / max) * 100}%` }} /></span>
                <span className="muted small">{w.open} open</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

/** The Board view: open tasks in one column per category. Tick a card to finish it. */
export function TaskColumns({ tasks, categories, today, canEdit, onDone }: { tasks: TaskDTO[]; categories: CategoryDTO[]; today: string; canEdit: boolean; onDone: (id: string) => void }) {
  const cols = boardColumns(tasks, categories, today);
  if (cols.every((c) => c.tasks.length === 0)) return <p className="muted">No open tasks.</p>;
  return (
    <div className="task-columns">
      {cols.map((c) => (
        <section key={c.id ?? "none"} className="tc-col" aria-label={c.name}>
          <h3>{c.name} <span className="muted small">{c.tasks.length}</span></h3>
          {c.tasks.length === 0 && <p className="muted small">Nothing here.</p>}
          {c.tasks.map((t) => (
            <div key={t.id} className="tc-card">
              <input type="checkbox" aria-label={`Finish ${t.title}`} disabled={!canEdit} onChange={() => onDone(t.id)} />
              <span>{t.title}{t.dueDate && <small className="muted"> · due {t.dueDate}</small>}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
