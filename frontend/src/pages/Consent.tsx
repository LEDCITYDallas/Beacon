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
    <div className="auth-shell">
      <div className="card auth-card auth-card-wide">
        <h2 className="page-title">Before you get started</h2>

        <p className="legal mt-4">
          This app is your assistant for what to do next — it tracks your
          tasks, tells you when a dependency is ready for you, and can draft
          routine replies for you to review and send.
        </p>

        <p className="legal mt-3">
          As part of using this system, please also note: your activity
          (such as idle/active status) may be tracked while you use it, and
          administrators may perform screen checks, including random spot
          checks, as part of standard account administration. Full details
          are in the company's monitoring policy.
        </p>

        <label className="choice choice-top">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>I have read and understood the above, and I accept.</span>
        </label>

        <button
          className="btn btn-block mt-4"
          disabled={!checked || busy}
          onClick={handleAccept}
        >
          {busy ? "Saving..." : "Accept & continue"}
        </button>

        {error && <p className="notice notice-danger">{error}</p>}

        <button
          className="btn btn-outline btn-block mt-2"
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
