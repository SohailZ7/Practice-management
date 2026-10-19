"use client";

import { useState } from "react";
import { createRecurring, deleteRecurring, updateRecurring } from "@/app/tasks/recurring-actions";
import { describeRule, nextOccurrenceAfter, WEEKDAYS } from "@/lib/recurrence";
import { formatShort } from "@/lib/dates";
import type { RecurringDTO, RecurringPatch } from "@/lib/taskTypes";

type Opt = { id: string; name: string };

const FREQ = [
  { value: "DAILY", label: "Daily (weekdays)" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

export function RecurringManager({
  initial,
  employees,
  isAdmin,
  defaultAssigneeId,
  today,
}: {
  initial: RecurringDTO[];
  employees: Opt[];
  isAdmin: boolean;
  defaultAssigneeId: string | null;
  today: string;
}) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState("");

  // New recurring task form
  const [title, setTitle] = useState("");
  const [assigneeId, setAssignee] = useState(defaultAssigneeId ?? "");
  const [frequency, setFrequency] = useState("WEEKLY");
  const [weekday, setWeekday] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [startDate, setStart] = useState(today);
  const [ends, setEnds] = useState(false);
  const [endDate, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong");
  const nameOf = (id: string | null) => employees.find((e) => e.id === id)?.name ?? "Unassigned";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const dto = await createRecurring({
        title,
        assigneeId: assigneeId || null,
        frequency,
        weekday: frequency === "WEEKLY" ? weekday : null,
        dayOfMonth: frequency === "MONTHLY" ? dayOfMonth : null,
        startDate,
        endDate: ends ? endDate || null : null,
      });
      setRows((rs) => [...rs, dto]);
      setTitle("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function patch(row: RecurringDTO, p: RecurringPatch) {
    const snapshot = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...p } : r)));
    setError("");
    try {
      const dto = await updateRecurring(row.id, p);
      setRows((rs) => rs.map((r) => (r.id === row.id ? dto : r)));
    } catch (err) {
      setRows(snapshot);
      fail(err);
    }
  }

  async function remove(row: RecurringDTO) {
    if (!window.confirm(`Stop repeating "${row.title}"? Tasks it already created stay in the queue.`)) return;
    const snapshot = rows;
    setRows((rs) => rs.filter((r) => r.id !== row.id));
    try {
      await deleteRecurring(row.id);
    } catch (err) {
      setRows(snapshot);
      fail(err);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}

      <form className="card recurring-form" onSubmit={add}>
        <strong>New recurring task</strong>
        <div className="row" style={{ marginTop: ".5rem" }}>
          <input className="grow" placeholder="What repeats? e.g. Submit weekly billing" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          {isAdmin && (
            <select value={assigneeId} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to">
              <option value="">Unassigned</option>
              {employees.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} aria-label="Frequency">
            {FREQ.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {frequency === "WEEKLY" && (
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} aria-label="Day of the week">
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
          {frequency === "MONTHLY" && (
            <label className="check">
              Day
              <input type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} style={{ width: 70 }} aria-label="Day of the month" />
            </label>
          )}
          <label className="check">
            Starts <input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </label>
          <EndControl ends={ends} endDate={endDate} onChange={(e, d) => { setEnds(e); setEnd(d); }} />
          <button type="submit" disabled={busy}>
            Add
          </button>
        </div>
        <p className="muted small" style={{ margin: ".5rem 0 0" }}>
          Each time it comes due, a task is added to the assignee&apos;s queue with that date as its due date, so it shows in Today
          and then Past due until it is checked off.
        </p>
      </form>

      <div className="table-wrap">
        <table className="recurring-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Assigned to</th>
              <th>Repeats</th>
              <th>Next</th>
              <th>Starts</th>
              <th>Ends</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Nothing repeats yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const next = r.active ? nextOccurrenceAfter(r, today) : null;
              return (
                <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <input
                      className="grow"
                      defaultValue={r.title}
                      aria-label="Title"
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim();
                        if (v && v !== r.title) patch(r, { title: v });
                        else e.currentTarget.value = r.title;
                      }}
                    />
                  </td>
                  <td>
                    {isAdmin ? (
                      <select value={r.assigneeId ?? ""} onChange={(e) => patch(r, { assigneeId: e.target.value || null })} aria-label="Assigned to">
                        <option value="">Unassigned</option>
                        {employees.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      nameOf(r.assigneeId)
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: ".3rem", flexWrap: "nowrap" }}>
                      <select value={r.frequency} onChange={(e) => patch(r, { frequency: e.target.value })} aria-label="Frequency">
                        {FREQ.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      {r.frequency === "WEEKLY" && (
                        <select value={r.weekday ?? 0} onChange={(e) => patch(r, { weekday: Number(e.target.value) })} aria-label="Day of the week">
                          {WEEKDAYS.map((d, i) => (
                            <option key={d} value={i}>
                              {d}
                            </option>
                          ))}
                        </select>
                      )}
                      {r.frequency === "MONTHLY" && (
                        <input
                          type="number"
                          min={1}
                          max={31}
                          defaultValue={r.dayOfMonth ?? 1}
                          style={{ width: 62 }}
                          aria-label="Day of the month"
                          onBlur={(e) => {
                            const v = Number(e.currentTarget.value);
                            if (v !== r.dayOfMonth) patch(r, { dayOfMonth: v });
                          }}
                        />
                      )}
                    </div>
                    <div className="muted small">{describeRule(r)}</div>
                  </td>
                  <td>{next ? formatShort(next) : "—"}</td>
                  <td>
                    <input type="date" defaultValue={r.startDate} aria-label="Start date" onBlur={(e) => e.currentTarget.value && e.currentTarget.value !== r.startDate && patch(r, { startDate: e.currentTarget.value })} />
                  </td>
                  <td>
                    <EndControl
                      ends={r.endDate !== null}
                      endDate={r.endDate ?? ""}
                      onChange={(ends, d) => {
                        const next = ends ? d || null : null;
                        if (ends && !d) return; // wait for a date to be picked
                        if (next !== r.endDate) patch(r, { endDate: next });
                      }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={r.active} onChange={(e) => patch(r, { active: e.target.checked })} aria-label="Active" />
                  </td>
                  <td>
                    <button className="danger" onClick={() => remove(r)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "Never ends" or "Ends on <date>". */
function EndControl({ ends, endDate, onChange }: { ends: boolean; endDate: string; onChange: (ends: boolean, date: string) => void }) {
  const [localEnds, setLocalEnds] = useState(ends);
  return (
    <span className="row" style={{ gap: ".3rem", flexWrap: "nowrap" }}>
      <select
        value={localEnds ? "date" : "never"}
        aria-label="End"
        onChange={(e) => {
          const wantsEnd = e.target.value === "date";
          setLocalEnds(wantsEnd);
          onChange(wantsEnd, wantsEnd ? endDate : "");
        }}
      >
        <option value="never">Never ends</option>
        <option value="date">Ends on…</option>
      </select>
      {localEnds && (
        <input type="date" value={endDate} aria-label="End date" onChange={(e) => onChange(true, e.target.value)} />
      )}
    </span>
  );
}
