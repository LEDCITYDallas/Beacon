import React, { useEffect, useRef, useState } from "react";

// Hand-drawn SVG charts for the dashboards. They only render the numbers they
// are given; every chart also exposes its values as text (a legend, a centre
// label, or a visually hidden table) so nothing is conveyed by colour alone.

export type Tone = "forest" | "emerald" | "amber" | "mint" | "sage" | "danger";

export interface Segment {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

export function DonutChart({
  segments,
  size = 116,
  thickness = 14,
  centerValue,
  centerLabel,
  label,
}: {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerValue: React.ReactNode;
  centerLabel?: string;
  label: string;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  const gap = visible.length > 1 ? 3 : 0;
  const centre = size / 2;
  let offset = 0;

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="donut-track" cx={centre} cy={centre} r={radius} strokeWidth={thickness} fill="none" />
        {total > 0
          ? visible.map((segment) => {
              const length = (segment.value / total) * circumference;
              const dash = Math.max(0.5, length - gap);
              const node = (
                <circle
                  key={segment.key}
                  className={`donut-seg tone-${segment.tone}`}
                  cx={centre}
                  cy={centre}
                  r={radius}
                  strokeWidth={thickness}
                  fill="none"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${centre} ${centre})`}
                />
              );
              offset += length;
              return node;
            })
          : null}
      </svg>
      <div className="donut-center" aria-hidden="true">
        <span className="donut-value">{centerValue}</span>
        {centerLabel ? <span className="donut-caption">{centerLabel}</span> : null}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function RingStat({
  value,
  tone,
  label,
  detail,
  size = 76,
  thickness = 7,
}: {
  value: number | null;
  tone: Tone;
  label: string;
  detail?: string;
  size?: number;
  thickness?: number;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const centre = size / 2;

  return (
    <div className="ring-stat">
      <div className="ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
          <circle className="ring-track" cx={centre} cy={centre} r={radius} strokeWidth={thickness} fill="none" />
          {pct > 0 ? (
            <circle
              className={`ring-arc tone-${tone}`}
              cx={centre}
              cy={centre}
              r={radius}
              strokeWidth={thickness}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
              transform={`rotate(-90 ${centre} ${centre})`}
            />
          ) : null}
        </svg>
        <span className="ring-value">{value === null ? "—" : `${Math.round(pct)}%`}</span>
      </div>
      <p className="ring-label">{label}</p>
      {detail ? <p className="ring-detail">{detail}</p> : null}
    </div>
  );
}

export function ChartLegend({
  items,
}: {
  items: { key: string; label: string; tone: Tone; value?: React.ReactNode }[];
}) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className={`swatch tone-${item.tone}`} aria-hidden="true" />
          <span>{item.label}</span>
          {item.value !== undefined ? <strong>{item.value}</strong> : null}
        </li>
      ))}
    </ul>
  );
}

export interface Series {
  key: string;
  label: string;
  tone: Tone;
  values: number[];
}

function useElementSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

// Four even intervals with a round step, so small task counts get whole-number
// gridlines (0-4) instead of fractions.
function niceScale(maxValue: number) {
  const target = Math.max(1, maxValue);
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000]) {
    if (step * 4 >= target) return { max: step * 4, step };
  }
  const step = Math.ceil(target / 4);
  return { max: step * 4, step };
}

function sign(value: number) {
  return value < 0 ? -1 : 1;
}

// Monotone cubic interpolation: smooth like the reference curves, but a line
// never dips below zero or overshoots a real value between two days.
function monotonePath(points: [number, number][]) {
  const n = points.length;
  if (n === 0) return "";
  const fmt = (value: number) => Number(value.toFixed(2));
  if (n < 3) return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`).join("");

  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const h = points[i + 1][0] - points[i][0];
    slopes.push(h === 0 ? 0 : (points[i + 1][1] - points[i][1]) / h);
  }
  const tangents = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    const h0 = points[i][0] - points[i - 1][0];
    const h1 = points[i + 1][0] - points[i][0];
    const s0 = slopes[i - 1];
    const s1 = slopes[i];
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    tangents[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  tangents[0] = (3 * slopes[0] - tangents[1]) / 2;
  tangents[n - 1] = (3 * slopes[n - 2] - tangents[n - 2]) / 2;

  let d = `M${fmt(points[0][0])},${fmt(points[0][1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = (x1 - x0) / 3;
    d += `C${fmt(x0 + dx)},${fmt(y0 + dx * tangents[i])} ${fmt(x1 - dx)},${fmt(y1 - dx * tangents[i + 1])} ${fmt(x1)},${fmt(y1)}`;
  }
  return d;
}

export function LineChart({
  labels,
  fullLabels,
  series,
  summary,
}: {
  labels: string[];
  fullLabels?: string[];
  series: Series[];
  summary: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(wrapRef);
  const [active, setActive] = useState<number | null>(null);

  const pad = { top: 12, right: 12, bottom: 30, left: 34 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = Math.max(0, height - pad.top - pad.bottom);
  const count = labels.length;
  const scale = niceScale(Math.max(0, ...series.flatMap((item) => item.values)));
  const ticks: number[] = [];
  for (let tick = 0; tick <= scale.max; tick += scale.step) ticks.push(tick);

  const x = (index: number) => pad.left + (count <= 1 ? innerW / 2 : (index / (count - 1)) * innerW);
  const y = (value: number) => pad.top + innerH - (value / scale.max) * innerH;

  function track(event: React.PointerEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg || count === 0 || innerW <= 0) return;
    const left = svg.getBoundingClientRect().left;
    const index = Math.round(((event.clientX - left - pad.left) / innerW) * (count - 1));
    setActive(Math.max(0, Math.min(count - 1, index)));
  }

  const ready = width > 0 && height > 0;
  const tipAlign =
    active === null ? "" : x(active) < 96 ? " is-start" : x(active) > width - 96 ? " is-end" : "";

  return (
    <div className="line-chart" ref={wrapRef}>
      {ready ? (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-axis" x={pad.left - 10} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {tick}
              </text>
            </g>
          ))}
          {labels.map((label, index) => (
            <text
              key={`${label}-${index}`}
              className={`chart-axis${active === index ? " is-active" : ""}`}
              x={x(index)}
              y={height - 8}
              textAnchor="middle"
            >
              {label}
            </text>
          ))}
          {active !== null ? (
            <line className="chart-guide" x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerH} />
          ) : null}
          {series.map((item) => (
            <path
              key={item.key}
              className={`chart-line tone-${item.tone}`}
              d={monotonePath(item.values.map((value, index) => [x(index), y(value)]))}
            />
          ))}
          {active !== null
            ? series.map((item) => (
                <circle
                  key={item.key}
                  className={`chart-dot tone-${item.tone}`}
                  cx={x(active)}
                  cy={y(item.values[active] ?? 0)}
                  r={4.5}
                />
              ))
            : null}
          <rect
            className="chart-hit"
            x={pad.left - 12}
            y={pad.top}
            width={innerW + 24}
            height={innerH}
            onPointerMove={track}
            onPointerDown={track}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      ) : null}
      {ready && active !== null ? (
        <div className={`chart-tip${tipAlign}`} style={{ left: x(active) }} aria-hidden="true">
          <p className="chart-tip-title">{fullLabels?.[active] ?? labels[active]}</p>
          {series.map((item) => (
            <p key={item.key} className="chart-tip-row">
              <span className={`swatch tone-${item.tone}`} />
              <span>{item.label}</span>
              <strong>{item.values[active] ?? 0}</strong>
            </p>
          ))}
        </div>
      ) : null}
      <div className="sr-only">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {series.map((item) => (
                <th key={item.key} scope="col">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={`${label}-${index}`}>
                <th scope="row">{fullLabels?.[index] ?? label}</th>
                {series.map((item) => (
                  <td key={item.key}>{item.values[index] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
