import React, { useCallback, useEffect, useState } from "react";
import client from "../api/client";

// ---------------------------------------------------------------------
// Super Admin settings (Priorities 1, 3, 5, 6, 8, 9, 10).
//
// One screen for the decisions the client still owns: score weights, retention
// periods, live-view role scope, integration wiring, the digest, and the audit
// trail. Everything here writes through an audited API and nothing here can
// turn on prohibited monitoring - the API rejects that.
// ---------------------------------------------------------------------

interface SystemStatus {
  environment: { nodeEnv: string; mockMode: boolean; productionTarget: string };
  ai: {
    provider: string;
    model: string;
    configured: boolean;
    live: boolean;
    fallbackToMock: boolean;
    monthlyBudgetUsd: number;
    dailyCallLimitPerUser: number;
    costPerMillion: { input: number; output: number };
  };
  notifications: {
    masterSwitch: string;
    email: { transport: string; live: boolean; configured: boolean; from: string };
    whatsapp: { live: boolean; configured: boolean; omairNumberSet: boolean };
    digest: { timezone: string; sendEnabled: boolean; hour: number; minute: number };
  };
  integrations: {
    driver: string;
    sources: {
      key: string;
      label: string;
      configured: boolean;
      requiredScopes: string[];
      evidenceKind: string;
    }[];
  };
  activity: {
    idleThresholdMinutes: number;
    heartbeatSeconds: number;
    collectKeystrokes: boolean;
    collectScreenContent: boolean;
    collectWebcam: boolean;
    collectAudio: boolean;
  };
  liveView: {
    allowedRoles: string[];
    excludeReducedMonitoring: boolean;
    requireEmployeeApproval: boolean;
    screenshotsEnabled: boolean;
    framesStored: boolean;
    frameTtlSeconds: number;
  };
  retention: {
    enabled: boolean;
    isApproved: boolean;
    days: Record<string, number | null>;
    note: string;
  };
  permissions: { version: number };
}

interface AiUsage {
  totals: { calls: number; totalTokens: number; estCostUsd: number; fallbacks: number; failures: number };
  month: { calls: number; estCostUsd: number; budgetUsd: number; overBudget: boolean };
  byDay: { _id: string; calls: number; estCostUsd: number }[];
  byUser: { name: string; department: string; calls: number; estCostUsd: number }[];
}

interface AuditRow {
  id: string;
  at: string;
  action: string;
  actorName: string;
  actorRole: string;
  targetType: string;
  meta: Record<string, unknown>;
}

const RETENTION_LABELS: Record<string, string> = {
  activityLogs: "Activity / idle logs",
  liveViewSessions: "Live-view session logs",
  notificationLogs: "Notification records",
  aiUsageLogs: "AI usage / cost rows",
  decidedProposals: "Decided message drafts",
  integrationSignals: "Integration signal evidence",
};

const ROLE_OPTIONS = ["SUPER_ADMIN", "MANAGER", "EMPLOYEE"];

export default function AdminSettings() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [isLive, setIsLive] = useState(false);
  const [retention, setRetention] = useState<Record<string, number | null>>({});
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [retentionApproved, setRetentionApproved] = useState(false);
  const [liveRoles, setLiveRoles] = useState<string[]>([]);
  const [excludeReduced, setExcludeReduced] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [digestSchedule, setDigestSchedule] = useState<{ nextRunLocal: string; sendEnabled: boolean } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const [s, u, r, p, sc, a, d] = await Promise.all([
        client.get("/admin/system"),
        client.get("/admin/ai-usage"),
        client.get("/admin/retention"),
        client.get("/admin/permissions"),
        client.get("/scorecard/settings"),
        client.get("/admin/audit?limit=25"),
        client.get("/digest/schedule").catch(() => null),
      ]);
      setStatus(s.data);
      setUsage(u.data);
      setRetention(r.data.settings.days);
      setRetentionEnabled(r.data.settings.enabled);
      setRetentionApproved(r.data.settings.isApproved);
      setLiveRoles(p.data.policy.liveView.allowedRoles);
      setExcludeReduced(p.data.policy.liveView.excludeReducedMonitoring);
      const w: Record<string, number> = {};
      for (const k of Object.keys(sc.data.weights || {})) w[k] = sc.data.weights[k];
      setWeights(w);
      setIsLive(Boolean(sc.data.isLive));
      setAudit(a.data);
      if (d) setDigestSchedule(d.data);
    } catch {
      setError("Could not load admin settings (Super Admin access is required).");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveWeights() {
    setNotice("");
    setError("");
    try {
      await client.put("/scorecard/weights", { weights, isLive });
      setNotice(
        isLive
          ? "Weights saved and the scorecard is now LIVE (isLive=true)."
          : "Weights saved. The scorecard stays in draft mode until isLive is enabled jointly."
      );
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not save weights");
    }
  }

  async function saveRetention() {
    setNotice("");
    setError("");
    try {
      await client.put("/admin/retention", {
        days: retention,
        enabled: retentionEnabled,
        isApproved: retentionApproved,
      });
      setNotice("Retention settings saved. The cleanup job only deletes once a period is approved.");
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Could not save retention settings");
    }
  }

  async function saveLiveViewScope() {
    setNotice("");
    setError("");
    try {
      await client.put("/admin/permissions", {
        overrides: {
          policy: {
            liveView: { allowedRoles: liveRoles, excludeReducedMonitoring: excludeReduced },
          },
        },
      });
      setNotice("Live-view scope updated (a config change, no redeploy needed).");
      await load();
    } catch (err: any) {
      const detail = err.response?.data?.errors?.join("; ");
      setError(detail || err.response?.data?.message || "Could not update permissions");
    }
  }

  async function runScan() {
    setScanResult("");
    setError("");
    try {
      const res = await client.post("/integrations/scan", { sinceHours: 24 });
      setScanResult(
        `Read ${res.data.signalsRead} signal(s) from ${res.data.sources.length} source(s): ` +
          `${res.data.proposals.length} completion proposal(s) raised, ${res.data.noMatch} with no match. ` +
          "No task was closed - each one needs the assignee's confirmation."
      );
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Scan failed");
    }
  }

  async function sendDigest() {
    setNotice("");
    setError("");
    try {
      const res = await client.post("/digest/send", {});
      setNotice(`Digest: ${res.data.status} (${res.data.driver}). ${res.data.explanation}`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || "Digest send failed");
    }
  }

  if (error && !status) return <p style={{ color: "var(--danger)" }}>{error}</p>;
  if (!status) return <p style={{ color: "var(--text-muted)" }}>Loading…</p>;
  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Administration</h2>
      <p style={{ color: "var(--text-muted)", marginTop: 0, fontSize: 14 }}>
        {status.environment.productionTarget} · env {status.environment.nodeEnv}
        {status.environment.mockMode ? " · mock mode" : " · live mode"}
      </p>

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {notice && <p style={{ color: "var(--success)" }}>{notice}</p>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>AI assistant & cost</h3>
        <p style={{ margin: 0, fontSize: 13 }}>
          Provider <strong>{status.ai.provider}</strong> ({status.ai.model}) ·{" "}
          {status.ai.live ? (
            <span style={{ color: "var(--success)" }}>live key configured</span>
          ) : (
            <span style={{ color: "var(--warning)" }}>
              not live — {status.ai.fallbackToMock ? "falling back to the labelled mock provider" : "calls will fail"}
            </span>
          )}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Cost assumptions: ${status.ai.costPerMillion.input}/1M input, ${status.ai.costPerMillion.output}
          /1M output · budget ${status.ai.monthlyBudgetUsd}/month · daily cap{" "}
          {status.ai.dailyCallLimitPerUser} calls per user
        </p>
        {usage && (
          <>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 8 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{usage.month.calls}</div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>calls this month</p>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  ${usage.month.estCostUsd.toFixed(2)}
                  {usage.month.overBudget && <span style={{ color: "var(--danger)" }}> over</span>}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                  estimated this month
                </p>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{usage.totals.fallbacks}</div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
                  mock fallbacks (provider issues)
                </p>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{usage.totals.failures}</div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>failed calls</p>
              </div>
            </div>
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Department</th>
                  <th>Calls</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.byUser.slice(0, 5).map((u) => (
                  <tr key={u.name}>
                    <td>{u.name}</td>
                    <td>{u.department}</td>
                    <td>{u.calls}</td>
                    <td>${u.estCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Scorecard weights (joint decision with Omair)</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          activityIdlePct is hard-capped at 10 and can never be the dominant factor. Reports stay in
          draft mode while isLive is false.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.keys(weights).map((k) => (
            <div key={k} style={{ minWidth: 150 }}>
              <label style={{ marginTop: 0 }}>{k}</label>
              <input
                type="number"
                min={0}
                max={k === "activityIdlePct" ? 10 : 100}
                value={weights[k]}
                onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={isLive}
            onChange={(e) => setIsLive(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>
            Activate the formula (isLive) — only tick this after the weights are agreed with Omair
          </span>
        </label>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => void saveWeights()}>
          Save weights
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Live-view role scope</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Pending the client decision (Section 12). Screenshots stay off for every role — v1 is live
          view only, and no frame is ever stored.
        </p>
        {ROLE_OPTIONS.map((r) => (
          <label key={r} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={liveRoles.includes(r)}
              onChange={(e) =>
                setLiveRoles(e.target.checked ? [...liveRoles, r] : liveRoles.filter((x) => x !== r))
              }
            />
            <span style={{ fontSize: 13 }}>{r} may request live view</span>
          </label>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={excludeReduced}
            onChange={(e) => setExcludeReduced(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>
            Exclude reduced-monitoring roles (activity/idle tracking only, never screens)
          </span>
        </label>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => void saveLiveViewScope()}>
          Save live-view scope
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Retention (client decision outstanding)</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Leave a field blank/0 to mean "not decided" — the cleanup job then skips that data type
          entirely instead of guessing a period.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.keys(RETENTION_LABELS).map((k) => (
            <div key={k} style={{ minWidth: 180 }}>
              <label style={{ marginTop: 0 }}>{RETENTION_LABELS[k]} (days)</label>
              <input
                type="number"
                min={1}
                value={retention[k] === null || retention[k] === undefined ? "" : retention[k]}
                placeholder="not decided"
                onChange={(e) =>
                  setRetention({ ...retention, [k]: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={retentionEnabled}
            onChange={(e) => setRetentionEnabled(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>Enable the cleanup job (npm run retention -- --apply)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={retentionApproved}
            onChange={(e) => setRetentionApproved(e.target.checked)}
          />
          <span style={{ fontSize: 13 }}>Omair has approved these periods</span>
        </label>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => void saveRetention()}>
          Save retention
        </button>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Integrations (Zoho / WorkDrive / CMS)</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Driver: <strong>{status.integrations.driver}</strong>. In mock mode each source reads labelled
          mock data, so the detect → propose → human-confirm flow is fully testable before Omair wires
          the OAuth tokens.
        </p>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Configured</th>
              <th>Completion signal</th>
              <th>Required scopes</th>
            </tr>
          </thead>
          <tbody>
            {status.integrations.sources.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td style={{ color: s.configured ? "var(--success)" : "var(--warning)" }}>
                  {s.configured ? "yes" : "needs OAuth"}
                </td>
                <td style={{ fontSize: 12 }}>{s.evidenceKind}</td>
                <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {s.requiredScopes.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => void runScan()}>
          Run completion scan now
        </button>
        {scanResult && <p style={{ fontSize: 13, color: "var(--accent-light)" }}>{scanResult}</p>}
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          A signal only ever raises a proposal. The assignee confirms it, and the evidence (source,
          external id, link) is stored on the task so a reviewer can see why.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Friday digest</h3>
        <p style={{ fontSize: 13 }}>
          Next scheduled run:{" "}
          <strong>{digestSchedule ? digestSchedule.nextRunLocal : "—"}</strong> ({status.notifications.digest.timezone}) ·
          delivery {status.notifications.digest.sendEnabled ? "enabled" : "not enabled yet"}
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          WhatsApp live: {String(status.notifications.whatsapp.live)} · Omair's number configured:{" "}
          {String(status.notifications.whatsapp.omairNumberSet)} · email transport:{" "}
          {status.notifications.email.transport} ({status.notifications.email.live ? "live" : "simulated"})
        </p>
        <button className="btn" onClick={() => void sendDigest()}>
          Generate & send digest now
        </button>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Sending is explicit and logged. With the mock driver the message is recorded as SIMULATED —
          no WhatsApp message leaves the machine until Omair wires the Cloud API credentials.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Monitoring scope (fixed)</h3>
        <p style={{ fontSize: 13 }}>
          Idle window: <strong>{status.activity.idleThresholdMinutes} minutes</strong> · heartbeat{" "}
          {status.activity.heartbeatSeconds}s · frames stored:{" "}
          <strong>{String(status.liveView.framesStored)}</strong> · screenshots:{" "}
          <strong>{String(status.liveView.screenshotsEnabled)}</strong>
        </p>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Keystrokes collected: {String(status.activity.collectKeystrokes)} · screen content:{" "}
          {String(status.activity.collectScreenContent)} · webcam: {String(status.activity.collectWebcam)} ·
          audio: {String(status.activity.collectAudio)} — these are prohibited and the API rejects any
          attempt to enable them.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Audit log (recent)</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.at).toLocaleString()}</td>
                <td>{a.action}</td>
                <td>
                  {a.actorName}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}> {a.actorRole}</span>
                </td>
                <td style={{ fontSize: 12 }}>{a.targetType}</td>
                <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {JSON.stringify(a.meta).slice(0, 120)}
                </td>
              </tr>
            ))}
            {audit.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
