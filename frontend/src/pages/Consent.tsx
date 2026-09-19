import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Consent() {
  const { acceptConsent, logout } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleAccept() {
    setBusy(true);
    setError("");
    try {
      await acceptConsent();
      navigate("/");
    } catch {
      setError("Could not record consent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 20,
      }}
    >
      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Before you get started</h2>

        <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
          This app is your assistant for what to do next — it tracks your
          tasks, tells you when a dependency is ready for you, and can draft
          routine replies for you to review and send.
        </p>

        <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
          As part of using this system, please also note: your activity
          (such as idle/active status) may be tracked while you use it, and
          administrators may perform screen checks, including random spot
          checks, as part of standard account administration. Full details
          are in the company's monitoring policy.
        </p>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16 }}>
          <input
            type="checkbox"
            style={{ width: "auto", marginTop: 3 }}
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span style={{ fontSize: 14 }}>
            I have read and understood the above, and I accept.
          </span>
        </label>

        <button
          className="btn"
          style={{ marginTop: 20 }}
          disabled={!checked || busy}
          onClick={handleAccept}
        >
          {busy ? "Saving..." : "Accept & continue"}
        </button>

        {error && (
          <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{error}</p>
        )}

        <button
          className="btn btn-outline"
          style={{ marginTop: 10 }}
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          Decline & sign out
        </button>
      </div>
    </div>
  );
}
