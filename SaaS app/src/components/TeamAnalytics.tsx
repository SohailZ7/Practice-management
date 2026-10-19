"use client";

import Link from "next/link";
import { useState } from "react";
import { WINDOWS, type Analytics, type TeamAnalytics as Team } from "@/lib/analytics";
import type { CategoryDTO } from "@/lib/taskTypes";
import { CategoryAnalyticsView, shortDate } from "./TaskAnalytics";

type Props = { team: Team; byCategory: Analytics; categories: CategoryDTO[] };

export function TeamAnalytics({ team: a, byCategory, categories }: Props) {
  const [mode, setMode] = useState<"employee" | "category">("employee");
  const n = a.periodDays;

  const chartW = 760;
  const chartH = 140;
  const gap = 2;
  const barW = chartW / a.days.length - gap;
  const withDone = a.people.filter((p) => p.completed > 0);

  return (
    <div className="analytics-panel">
      <div className="todo-toolbar">
        <div className="tab-switcher" role="group" aria-label="Window">
          {WINDOWS.map((w) => (
            <Link key={w} href={`/tasks/analytics?days=${w}`} className={`tab-btn ${w === n ? "active" : ""}`} aria-current={w === n ? "true" : undefined} scroll={false}>
              {w} days
            </Link>
          ))}
        </div>
        <div className="tab-switcher" role="tablist" aria-label="Colour by">
          <button role="tab" aria-selected={mode === "employee"} className={`tab-btn ${mode === "employee" ? "active" : ""}`} onClick={() => setMode("employee")}>
            By employee
          </button>
          <button role="tab" aria-selected={mode === "category"} className={`tab-btn ${mode === "category" ? "active" : ""}`} onClick={() => setMode("category")}>
            By category
          </button>
        </div>
      </div>

      {mode === "category" ? (
        a.totalCompleted === 0 ? (
          <EmptyNote n={n} />
        ) : (
          <CategoryAnalyticsView a={byCategory} categories={categories} periodDays={n} />
        )
      ) : (
        <>
          <section className="analytics-section">
            <h2 className="analytics-heading">Daily velocity, last {n} days</h2>
            {a.totalCompleted === 0 ? (
              <EmptyNote n={n} />
            ) : (
              <>
                <p className="analytics-subtext">
                  {a.totalCompleted} completed · {a.avgPerDay.toFixed(2)}/day average
                </p>
                <svg
                  className="velocity-chart"
                  viewBox={`0 0 ${chartW} ${chartH + 20}`}
                  role="img"
                  aria-label="Stacked bar chart of tasks completed per day, colored by employee"
                >
                  {a.days.map((day, i) => {
                    let y = chartH;
                    const segments = withDone
                      .map((p) => ({ p, count: a.counts[day][p.id] ?? 0 }))
                      .filter((s) => s.count > 0)
                      .map((s) => {
                        const h = (s.count / a.maxDayTotal) * (chartH - 4);
                        y -= h;
                        return { ...s, y, h };
                      });
                    const x = i * (barW + gap);
                    const showLabel = i === 0 || i === a.days.length - 1 || i % (n > 30 ? 10 : 5) === 0;
                    return (
                      <g key={day}>
                        {segments.map((s) => (
                          <rect key={s.p.id} x={x} y={s.y} width={barW} height={Math.max(s.h, 1)} fill={s.p.color} rx={1}>
                            <title>
                              {shortDate(day)} · {s.p.name}: {s.count}
                            </title>
                          </rect>
                        ))}
                        {showLabel && (
                          <text x={x + barW / 2} y={chartH + 14} className="chart-axis-label" textAnchor="middle">
                            {shortDate(day)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                <div className="chart-legend">
                  {withDone.map((p) => (
                    <span key={p.id} className="legend-item">
                      <span className="legend-swatch" style={{ background: p.color }} />
                      {p.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="analytics-section">
            <h2 className="analytics-heading">By employee</h2>
            <div className="analytics-table-scroll">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Completed ({n}d)</th>
                    <th>Avg / day</th>
                    <th>Open</th>
                    <th>Past due</th>
                  </tr>
                </thead>
                <tbody>
                  {a.people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="legend-swatch" style={{ background: p.color }} />
                        {p.name}
                        {!p.active && <span className="muted"> (inactive)</span>}
                      </td>
                      <td>{p.completed}</td>
                      <td>{p.avgPerDay.toFixed(2)}</td>
                      <td>{p.open}</td>
                      <td className={p.pastDue > 0 ? "analytics-bad" : undefined}>{p.pastDue}</td>
                    </tr>
                  ))}
                  <tr className="analytics-total-row">
                    <td>Total</td>
                    <td>{a.totalCompleted}</td>
                    <td>{a.avgPerDay.toFixed(2)}</td>
                    <td>{a.totalOpen}</td>
                    <td>{a.totalPastDue}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {a.undated > 0 && (
              <p className="analytics-subtext" style={{ marginTop: ".6rem", marginBottom: 0 }}>
                {a.undated} completed {a.undated === 1 ? "task has" : "tasks have"} no date (finished before dates were tracked), so
                {a.undated === 1 ? " it is" : " they are"} not counted in velocity.
              </p>
            )}
          </section>

          {a.totalCompleted > 0 && (
            <section className="analytics-section">
              <h2 className="analytics-heading">Daily breakdown</h2>
              <div className="analytics-table-scroll">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      {withDone.map((p) => (
                        <th key={p.id}>{p.name}</th>
                      ))}
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...a.days]
                      .reverse()
                      .map((day) => {
                        const total = a.dayTotals[a.days.indexOf(day)];
                        if (total === 0) return null;
                        return (
                          <tr key={day}>
                            <td>{shortDate(day)}</td>
                            {withDone.map((p) => (
                              <td key={p.id}>{a.counts[day][p.id] ?? 0}</td>
                            ))}
                            <td>{total}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function EmptyNote({ n }: { n: number }) {
  return <p className="muted">Nobody has completed a task in the last {n} days yet. Velocity starts tracking the moment something is checked off.</p>;
}
