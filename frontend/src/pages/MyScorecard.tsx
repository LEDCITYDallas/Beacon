import React, { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../utils/format";

// ---------------------------------------------------------------------
// Employee weekly + monthly scorecard (Priority 4 / Section 7).
//
// The employee sees the same inputs the manager does, so a performance
// conversation is never a surprise. While the weights are unapproved the report
// carries an explicit DRAFT banner - it is visibility, not a verdict, and it
// never feeds an employment decision.
// ---------------------------------------------------------------------

interface Inputs {
  tasksCompleted: number;
  onTimePct: number | null;
  estimateAccuracyPct: number | null;
  hoursLogged: number;
  reopenedCount: number;
  managerRating: number | null;
  activityIdlePct: number;
}

interface Period {
  period: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  inputs: Inputs;
  score: { value: number | null; totalWeight: number; activityIdleShare?: number };
  isLive: boolean;
  banner: string | null;
}

interface TrendRow {
  label: string;
  score: number | null;
  tasksCompleted: number;
  onTimePct: number | null;
  hoursLogged: number;
  activityIdlePct: number;
}

interface Report {
  week: Period;
  month: Period;
  trends: { weeks: TrendRow[]; months: TrendRow[] };
}

function Metric({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 600, color: muted ? "var(--text-muted)" : undefined }}>
        {value}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{label}</p>
    </div>
  );
}

export default function MyScorecard() {
  const { user } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get("/scorecard/my")
      .then((res) => setReport(res.data))
      .catch(() => setError("Could not load your scorecard."));
  }, []);

  if (error) return <p style={{ color: "var(--danger)" }}>{error}</p>;
  if (!report) return <p style={{ color: "var(--text-muted)" }}>Loading your scorecard…</p>;

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>My scorecard</h2>
      <p style={{ color: "var(--text-muted)", marginTop: 0, fontSize: 14 }}>
        Your own numbers, in your timezone ({user?.timezone}). Ask your manager for a walkthrough at
        any time.
      </p>

      <PeriodCard period={report.week} />
      <PeriodCard period={report.month} />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Trend</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Last 4 weeks (oldest first)</p>
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Score</th>
              <th>Tasks</th>
              <th>On time</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {report.trends.weeks.map((t) => (
              <tr key={t.label}>
                <td>{t.label}</td>
                <td>{t.score === null ? "—" : t.score}</td>
                <td>{t.tasksCompleted}</td>
                <td>{t.onTimePct === null ? "—" : `${t.onTimePct}%`}</td>
                <td>{t.hoursLogged}h</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 16 }}>Monthly view</p>
        <table>
          <thead>
            <tr>
              <th>Month of</th>
              <th>Score</th>
              <th>Tasks</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {report.trends.months.map((t) => (
              <tr key={t.label}>
                <td>{t.label}</td>
                <td>{t.score === null ? "—" : t.score}</td>
                <td>{t.tasksCompleted}</td>
                <td>{t.hoursLogged}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function PeriodCard({ period }: { period: Period }) {
  const i = period.inputs;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0, textTransform: "capitalize" }}>{period.period}</h3>
        <div style={{ fontSize: 30, fontWeight: 700, color: "var(--accent-light)" }}>
          {period.score.value === null ? "—" : period.score.value}
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}> / 100</span>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 12px" }}>
        {formatDate(period.windowStart, period.timezone)} →{" "}
        {formatDate(period.windowEnd, period.timezone)} ({period.timezone})
      </p>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Metric label="tasks completed" value={String(i.tasksCompleted)} />
        <Metric label="on time" value={i.onTimePct === null ? "—" : `${i.onTimePct}%`} />
        <Metric
          label="estimate accuracy"
          value={i.estimateAccuracyPct === null ? "—" : `${i.estimateAccuracyPct}%`}
        />
        <Metric label="hours logged" value={`${i.hoursLogged}h`} />
        <Metric label="reopened" value={String(i.reopenedCount)} />
        <Metric
          label="manager rating"
          value={i.managerRating === null ? "not rated" : `${i.managerRating}/5`}
        />
        <Metric label="activity observed" value={`${i.activityIdlePct}%`} muted />
      </div>

      {period.banner && (
        <p style={{ marginTop: 12, fontSize: 12, color: "var(--warning)" }}>{period.banner}</p>
      )}
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 0 }}>
        Activity/idle can never dominate this score (weight capped at 10), and this report never
        triggers any automatic decision.
      </p>
    </div>
  );
}
