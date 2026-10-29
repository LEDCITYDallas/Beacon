import React, { useId, useState } from "react";
import Icon from "./Icon";
import StatusBadge from "./StatusBadge";
import { DueItem, dayLong, dayShort } from "../utils/dashboard";

const WEEKDAYS = [
  ["S", "Sunday"],
  ["M", "Monday"],
  ["T", "Tuesday"],
  ["W", "Wednesday"],
  ["T", "Thursday"],
  ["F", "Friday"],
  ["S", "Saturday"],
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

// Month grid of task due dates. Only days that have something due are
// buttons, so keyboard users tab through real dates instead of 30 empty cells.
export default function MonthCalendar({
  todayKey,
  days,
  caption,
}: {
  todayKey: string;
  days: Record<string, DueItem[]>;
  caption: string;
}) {
  const titleId = useId();
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const [view, setView] = useState({ year: todayYear, month: todayMonth - 1 });
  const [selected, setSelected] = useState(todayKey);

  const first = new Date(Date.UTC(view.year, view.month, 1));
  const leading = first.getUTCDay();
  const length = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(first);

  function move(step: number) {
    setView((current) => {
      const next = new Date(Date.UTC(current.year, current.month + step, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }

  const selectedItems = days[selected] || [];

  return (
    <section className="card cal-card" aria-labelledby={titleId}>
      <div className="cal-head">
        <div>
          <h2 id={titleId} className="card-title mb-0">
            {monthLabel}
          </h2>
          <p className="cal-caption">{caption}</p>
        </div>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => move(-1)}>
            <Icon name="chevronLeft" size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => move(1)}>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </div>
      <table className="cal-table">
        <thead>
          <tr>
            {WEEKDAYS.map(([short, full]) => (
              <th key={full} scope="col">
                <abbr title={full}>{short}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, row) => (
            <tr key={`${view.year}-${view.month}-${row}`}>
              {week.map((day, column) => {
                if (day === null) return <td key={`blank-${row}-${column}`} />;
                const key = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
                const items = days[key] || [];
                const overdue = items.some((item) => item.overdue);
                const classes = [
                  "cal-day",
                  key === todayKey ? "is-today" : "",
                  key === selected ? "is-selected" : "",
                  items.length > 0 ? "has-items" : "",
                  overdue ? "has-overdue" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td key={key}>
                    {items.length > 0 ? (
                      <button
                        type="button"
                        className={classes}
                        aria-pressed={key === selected}
                        aria-label={`${dayLong(key)}: ${items.length} ${items.length === 1 ? "task" : "tasks"} due${
                          overdue ? ", overdue" : ""
                        }`}
                        onClick={() => setSelected(key)}
                      >
                        {day}
                      </button>
                    ) : (
                      <span className={classes} aria-current={key === todayKey ? "date" : undefined}>
                        {day}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cal-agenda" aria-live="polite">
        <p className="cal-agenda-title">
          {selected === todayKey ? "Due today" : `Due ${dayShort(selected)}`}
        </p>
        {selectedItems.length === 0 ? (
          <p className="cal-agenda-empty">Nothing due on this day.</p>
        ) : (
          <ul className="cal-agenda-list">
            {selectedItems.slice(0, 4).map((item) => (
              <li key={item.id}>
                <span className="cal-agenda-text">
                  <span className="cal-agenda-name">{item.title}</span>
                  {item.meta ? <span className="cal-agenda-meta">{item.meta}</span> : null}
                </span>
                {item.overdue ? <span className="pill pill-danger">Overdue</span> : <StatusBadge status={item.status} />}
              </li>
            ))}
            {selectedItems.length > 4 ? (
              <li className="cal-agenda-more">+{selectedItems.length - 4} more due this day</li>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}
