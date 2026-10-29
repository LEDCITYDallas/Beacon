import React, { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../utils/format";
import PageHeader from "../components/PageHeader";
import LoadingState from "../components/LoadingState";

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
    <div className="stat-card">
      <div className={`stat-value-sm ${muted ? "stat-value-muted" : "stat-value-quiet"}`}>{value}</div>
      <p className="stat-label">{label}</p>
    </div>
  );
}

// One cell per trend period - the same compact equal-width row the manager
// scorecard uses, so both scorecards read the same way (design pass).
function TrendStrip({ rows }: { rows: TrendRow[] }) {
  return (
    <div className="strip">
      {rows.map((t, i) => (
        <div
          key={t.label}
          className={i === rows.length - 1 ? "strip-cell strip-cell-current" : "strip-cell"}
        >
          <div className={`strip-cell-value ${t.score === null ? "strip-cell-value-empty" : ""}`}>
            {t.score === null ? "—" : t.score}
          </div>
          <div className="strip-cell-label">
            {t.label} · {t.tasksCompleted}
          </div>
        </div>
      ))}
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

  if (error) return <p className="notice notice-danger state-message">{error}</p>;
  if (!report) return <LoadingState label="Loading your scorecard…" />;

  return (
    <div>
      <PageHeader
        title="My scorecard"
        description={
          report.week.isLive
            ? `Your own numbers, in your timezone (${user?.timezone}).`
            : `Draft view, not an official performance score. Timezone: ${user?.timezone}.`
        }
      />

      <PeriodCard period={report.week} />
      <PeriodCard period={report.month} />

      <div className="card">
        <h3 className="card-title">Trend</h3>
        <p className="card-intro">Last 4 weeks (oldest first)</p>
        <TrendStrip rows={report.trends.weeks} />
        <table className="mt-4">
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

        <p className="card-intro mt-5">Monthly view</p>
        <TrendStrip rows={report.trends.months} />
        <table className="mt-4">
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
      <div className="row-between baseline">
        <h3 className="m-0 capitalize">{period.period}</h3>
        <div>
          {!period.isLive && <div className="text-micro muted">Draft score</div>}
          <div className="stat-value">
            {period.score.value === null ? "—" : period.score.value}
            <span className="stat-unit"> / 100</span>
          </div>
        </div>
      </div>
      <p className="card-intro mt-2 mb-4">
        {formatDate(period.windowStart, period.timezone)} →{" "}
        {formatDate(period.windowEnd, period.timezone)} ({period.timezone})
      </p>

      <div className="stat-row">
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

      {period.banner && <p className="notice notice-warning">{period.banner}</p>}
      <p className="text-micro muted mb-0 mt-3">
        Activity/idle can never dominate this score (weight capped at 10), and this report never
        triggers any automatic decision.
      </p>
    </div>
  );
}
