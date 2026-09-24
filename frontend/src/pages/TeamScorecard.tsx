import React, { useCallback, useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDayShort } from "../utils/format";
import Avatar from "../components/Avatar";

// ---------------------------------------------------------------------
// Manager / Super Admin scorecard (Priority 4 / Section 7).
//
// This is the manager's department view: every tracked person's week, the
// inputs behind the number, the 4-week trend, and the manager rating entry that
// feeds the formula. The weight panel is read-only here - the formula belongs
// to Omair (PUT /api/scorecard/weights, Super Admin only).
// ---------------------------------------------------------------------

interface MemberRow {
  employee: {
    id: string;
    name: string;
    department: string;
    role: string;
    timezone: string;
    reducedMonitoring: boolean;
  };
  week: {
    score: number | null;
    windowStart: string;
    inputs: {
      tasksCompleted: number;
      onTimePct: number | null;
      estimateAccuracyPct: number | null;
      hoursLogged: number;
      reopenedCount: number;
      managerRating: number | null;
      activityIdlePct: number;
    };
  };
  trend: { label: string; score: number | null; tasksCompleted: number }[];
}

interface TeamReport {
  isLive: boolean;
  banner: string | null;
  department: string;
  weights: Record<string, number>;
  members: MemberRow[];
  note: string;
}

interface RatingRow {
  id: string;
  employee: { id: string; name: string; department: string } | null;
  weekStart: string;
  score: number;
  note: string;
  ratedBy: string;
}

interface DepartmentRow {
  department: string;
  people: number;
  averageScore: number | null;
  tasksCompletedThisWeek: number;
  averageOnTimePct: number | null;
}

// Compact 4-week strip: one equal-width cell per week, score on top and the
// week label underneath - the same strip the employee scorecard uses, so both
// read the same way (design pass). Labels are zone-local day keys.
function TrendStrip({ rows }: { rows: MemberRow["trend"] }) {
  return (
    <div className="strip strip-inline">
      {rows.map((t, i) => (
        <div
          key={t.label}
          className={i === rows.length - 1 ? "strip-cell strip-cell-current" : "strip-cell"}
        >
          <div className={`strip-cell-value ${t.score === null ? "strip-cell-value-empty" : ""}`}>
            {t.score === null ? "–" : t.score}
          </div>
          <div className="strip-cell-label">{formatDayShort(t.label)}</div>
        </div>
      ))}
    </div>
  );
}

export default function TeamScorecard() {
  const { user } = useAuth();
  const [report, setReport] = useState<TeamReport | null>(null);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [error, setError] = useState("");
  const [ratingNote, setRatingNote] = useState("");
  const [ratingNotice, setRatingNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await client.get("/scorecard/team");
      setReport(res.data);
      const r = await client.get("/scorecard/ratings");
      setRatings(r.data);
      if (user?.role === "SUPER_ADMIN") {
        const d = await client.get("/scorecard/departments");
        setDepartments(d.data.departments);
      }
    } catch {
      setError("Could not load the team scorecard.");
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRating(employeeId: string, score: number) {
    setRatingNotice("");
    setError("");
    try {
      await client.post("/scorecard/rate", { employeeId, score, note: ratingNote });
      setRatingNote("");
      setRatingNotice("Rating saved for the current week (in the employee's own timezone).");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not save the rating");
    }
  }

  if (error && !report) return <p className="notice notice-danger">{error}</p>;
  if (!report) return <p className="muted">Loading team scorecard…</p>;

  return (
    <div>
      <h2 className="page-title">Team scorecard</h2>
      <p className="page-sub">
        {report.department === "all" ? "All departments" : report.department} · week boundaries use each
        person's own timezone.
      </p>

      {report.banner && (
        <div className="card card-warn">
          <p className="notice notice-warning mb-2">{report.banner}</p>
          <p className="text-micro muted m-0">
            Weights in use: {Object.entries(report.weights).map(([k, v]) => `${k} ${v}%`).join(" · ")}
          </p>
        </div>
      )}

      {error && <p className="notice notice-danger">{error}</p>}
      {ratingNotice && <p className="notice notice-success">{ratingNotice}</p>}
      <div className="card card-flush">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Week score</th>
              <th>Tasks</th>
              <th>On time</th>
              <th>Est. accuracy</th>
              <th>Reopened</th>
              <th>Activity</th>
              <th>Trend (4w)</th>
              <th>Rate this week</th>
            </tr>
          </thead>
          <tbody>
            {report.members.map((m) => (
              <tr key={m.employee.id}>
                <td>
                  <div className="person">
                    <Avatar name={m.employee.name} size="sm" />
                    <div>
                      <div className="person-name">{m.employee.name}</div>
                      <div className="person-meta">
                        {m.employee.department} · {m.employee.timezone}
                        {m.employee.reducedMonitoring ? " · reduced monitoring" : ""}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="cell-strong">{m.week.score === null ? "—" : m.week.score}</td>
                <td>{m.week.inputs.tasksCompleted}</td>
                <td>{m.week.inputs.onTimePct === null ? "—" : `${m.week.inputs.onTimePct}%`}</td>
                <td>
                  {m.week.inputs.estimateAccuracyPct === null
                    ? "—"
                    : `${m.week.inputs.estimateAccuracyPct}%`}
                </td>
                <td>{m.week.inputs.reopenedCount}</td>
                <td className="cell-muted">{m.week.inputs.activityIdlePct}%</td>
                <td>
                  <TrendStrip rows={m.trend} />
                </td>
                <td>
                  <div className="cell-actions">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        className="btn btn-outline btn-sm"
                        onClick={() => void submitRating(m.employee.id, s)}
                        title={`Rate ${m.employee.name} ${s}/5`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {report.members.length === 0 && (
              <tr>
                <td colSpan={9} className="cell-empty">
                  No tracked employees in your scope yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="card-title">Optional note for the next rating</h3>
        <textarea
          rows={2}
          value={ratingNote}
          onChange={(e) => setRatingNote(e.target.value)}
          placeholder="Context for the rating (visible to administrators, not used by the formula)"
        />
        <p className="text-xs muted mb-0">{report.note}</p>
      </div>

      <div className="card">
        <h3 className="card-title">Recent ratings</h3>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Week of</th>
              <th>Score</th>
              <th>Note</th>
              <th>Rated by</th>
            </tr>
          </thead>
          <tbody>
            {ratings.slice(0, 10).map((r) => (
              <tr key={r.id}>
                <td>{r.employee?.name || "—"}</td>
                <td>{formatDate(r.weekStart, user?.timezone)}</td>
                <td>{r.score}/5</td>
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.note || "—"}</td>
                <td style={{ fontSize: 12 }}>{r.ratedBy}</td>
              </tr>
            ))}
            {ratings.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  No ratings recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {user?.role === "SUPER_ADMIN" && departments.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Department roll-up (Super Admin)</h3>
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>People</th>
                <th>Average score</th>
                <th>Tasks this week</th>
                <th>Average on-time</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.department}>
                  <td>{d.department}</td>
                  <td>{d.people}</td>
                  <td>{d.averageScore === null ? "—" : d.averageScore}</td>
                  <td>{d.tasksCompletedThisWeek}</td>
                  <td>{d.averageOnTimePct === null ? "—" : `${d.averageOnTimePct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}