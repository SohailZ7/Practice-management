"use client";

import { useMemo } from "react";
import { NO_CATEGORY, buildAnalytics } from "@/lib/analytics";
import type { CategoryDTO, TaskDTO } from "@/lib/taskTypes";

const PALETTE = ["#5b8def", "#d97706", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#4b5563"];
const PERIOD_DAYS = 30;

function shortDate(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TaskAnalytics({ tasks, categories }: { tasks: TaskDTO[]; categories: CategoryDTO[] }) {
  const a = useMemo(
    () => buildAnalytics(tasks, categories.map((c) => c.id), PERIOD_DAYS),
    [tasks, categories],
  );
  const trackIds = [...categories.map((c) => c.id), NO_CATEGORY];
  const color = (id: string) => PALETTE[trackIds.indexOf(id) % PALETTE.length];
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? "No category";

  if (a.totalCompleted === 0) {
    return (
      <div className="analytics-panel">
        <p className="muted">
          No completions in the last {PERIOD_DAYS} days yet. Velocity starts tracking the moment you check something off.
        </p>
      </div>
    );
  }

  const chartW = 760;
  const chartH = 140;
  const gap = 2;
  const barW = chartW / a.days.length - gap;

  return (
    <div className="analytics-panel">
      <section className="analytics-section">
        <h2 className="analytics-heading">Daily velocity — last {PERIOD_DAYS} days</h2>
        <p className="analytics-subtext">
          {a.totalCompleted} completed · {a.avgPerDay.toFixed(2)}/day average
        </p>
        <svg
          className="velocity-chart"
          viewBox={`0 0 ${chartW} ${chartH + 20}`}
          role="img"
          aria-label="Stacked bar chart of tasks completed per day, colored by category"
        >
          {a.days.map((day, i) => {
            let y = chartH;
            const segments = a.tracks
              .map((id) => ({ id, count: a.counts[day][id] ?? 0 }))
              .filter((s) => s.count > 0)
              .map((s) => {
                const h = (s.count / a.maxDayTotal) * (chartH - 4);
                y -= h;
                return { ...s, y, h };
              });
            const x = i * (barW + gap);
            const showLabel = i === 0 || i === a.days.length - 1 || i % 5 === 0;
            return (
              <g key={day}>
                {segments.map((s) => (
                  <rect key={s.id} x={x} y={s.y} width={barW} height={Math.max(s.h, 1)} fill={color(s.id)} rx={1}>
                    <title>
                      {shortDate(day)} · {nameOf(s.id)}: {s.count}
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
        {a.tracks.length > 1 && (
          <div className="chart-legend">
            {a.tracks.map((id) => (
              <span key={id} className="legend-item">
                <span className="legend-swatch" style={{ background: color(id) }} />
                {nameOf(id)}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="analytics-section">
        <h2 className="analytics-heading">By category</h2>
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Completed ({PERIOD_DAYS}d)</th>
              <th>Avg / day</th>
            </tr>
          </thead>
          <tbody>
            {[...a.byTrack]
              .sort((x, y) => y.total - x.total)
              .map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="legend-swatch" style={{ background: color(c.id) }} />
                    {nameOf(c.id)}
                  </td>
                  <td>{c.total}</td>
                  <td>{c.avgPerDay.toFixed(2)}</td>
                </tr>
              ))}
            <tr className="analytics-total-row">
              <td>Total</td>
              <td>{a.totalCompleted}</td>
              <td>{a.avgPerDay.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="analytics-section">
        <h2 className="analytics-heading">Daily breakdown</h2>
        <div className="analytics-table-scroll">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Date</th>
                {a.tracks.map((id) => (
                  <th key={id}>{nameOf(id)}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {[...a.days]
                .reverse()
                .map((day) => {
                  const total = a.tracks.reduce((sum, id) => sum + (a.counts[day][id] ?? 0), 0);
                  if (total === 0) return null;
                  return (
                    <tr key={day}>
                      <td>{shortDate(day)}</td>
                      {a.tracks.map((id) => (
                        <td key={id}>{a.counts[day][id] ?? 0}</td>
                      ))}
                      <td>{total}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
