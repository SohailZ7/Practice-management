const KIND: Record<string, string> = {
  assigned: "Reassigned",
  "created-for": "Created for",
  "tab-removed": "Tab removed",
};

export type MoveRow = { id: string; when: string; title: string | null; from: string; to: string; by: string; kind: string };

/** TSK-62: the Admin's log of tasks moved between employees. Titles come from the live task, never the log. */
export function TaskMovesLog({ rows, days }: { rows: MoveRow[]; days: number }) {
  return (
    <section>
      <h2>Task moves</h2>
      <p className="muted small">Tasks moved between employees in the last {days} days (newest first). This log cannot be edited.</p>
      {rows.length === 0 ? (
        <p className="muted">No tasks were moved in this period.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Task</th>
                <th>From</th>
                <th>To</th>
                <th>Moved by</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.when.replace("T", " ").slice(0, 16)} UTC</td>
                  <td>{r.title ?? <span className="muted">(deleted task)</span>}</td>
                  <td>{r.from}</td>
                  <td>{r.to}</td>
                  <td className="small">{r.by}</td>
                  <td className="small">{KIND[r.kind] ?? r.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
