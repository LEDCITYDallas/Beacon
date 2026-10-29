import React, { useId, useState } from "react";
import { ChartLegend, LineChart, Series } from "./Charts";
import { Task } from "../types";
import { activityCounts, dayLong, dayShort, shiftKey, weekdayShort, windowKeys } from "../utils/dashboard";

export interface StripItem {
  key: string;
  label: string;
  value: React.ReactNode;
  tone?: "danger" | "warning" | "accent";
}

// Three-figure summary strip at the top of the right rail.
export function StatStrip({ label, items }: { label: string; items: StripItem[] }) {
  return (
    <section className="card stat-strip" aria-label={label}>
      <dl className="stat-strip-grid">
        {items.map((item) => (
          <div key={item.key} className="stat-strip-cell">
            <dt className="stat-strip-label">{item.label}</dt>
            <dd className={`stat-strip-value${item.tone ? ` is-${item.tone}` : ""}`}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Seven-day line chart of task timeline events. The window is a rolling seven
// days ending today in the user's timezone, or the seven days before that.
export function ActivityCard({
  tasks,
  todayKey,
  timeZone,
  caption,
}: {
  tasks: Task[];
  todayKey: string;
  timeZone?: string;
  caption: string;
}) {
  const titleId = useId();
  const [offset, setOffset] = useState(0);
  const keys = windowKeys(shiftKey(todayKey, -offset), 7);
  const counts = activityCounts(tasks, keys, timeZone);
  const series: Series[] = [
    { key: "created", label: "Created", tone: "amber", values: counts.created },
    { key: "started", label: "Started", tone: "emerald", values: counts.started },
    { key: "completed", label: "Completed", tone: "forest", values: counts.completed },
  ];
  const totals = series.map((item) => item.values.reduce((sum, value) => sum + value, 0));
  const rangeLabel = (start: number) =>
    `${dayShort(shiftKey(todayKey, -start - 6))} – ${dayShort(shiftKey(todayKey, -start))}`;

  return (
    <section className="card activity-card" aria-labelledby={titleId}>
      <div className="card-head">
        <div>
          <h2 id={titleId} className="card-title mb-0">
            Weekly activity
          </h2>
          <p className="card-caption">{caption}</p>
        </div>
        <label className="range-select">
          <span className="sr-only">Date range</span>
          <select value={offset} onChange={(event) => setOffset(Number(event.target.value))}>
            <option value={0}>{rangeLabel(0)}</option>
            <option value={7}>{rangeLabel(7)}</option>
          </select>
        </label>
      </div>
      <div className="activity-plot">
        <LineChart
          labels={keys.map(weekdayShort)}
          fullLabels={keys.map(dayLong)}
          series={series}
          summary={`Weekly activity, ${rangeLabel(offset)}: task events per day`}
        />
        {totals.every((total) => total === 0) ? (
          <p className="chart-empty">No task activity in this range.</p>
        ) : null}
      </div>
      <ChartLegend
        items={series.map((item, index) => ({
          key: item.key,
          label: item.label,
          tone: item.tone,
          value: totals[index],
        }))}
      />
    </section>
  );
}
