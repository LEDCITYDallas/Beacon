import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import LoadingState from "../components/LoadingState";
import { BrandGlyph, BrandWordmark } from "../components/Brand";

interface ConsentSection {
  heading: string;
  body: string;
}

interface ConsentDocument {
  version: string;
  legallyApproved: boolean;
  status: string;
  title: string;
  sections: ConsentSection[];
}

export default function Consent() {
  const { acceptConsent, logout, user } = useAuth();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<ConsentDocument | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get("/auth/consent")
      .then((res) => setDoc(res.data))
      .catch(() => setError("Could not load the consent notice. You cannot accept it until it loads."));
  }, []);

  async function handleAccept() {
    if (!doc || doc.legallyApproved !== false) return;
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
        <div className="auth-brand">
          <BrandGlyph size={52} />
          <BrandWordmark />
        </div>
        <h2 className="page-title">{doc?.title || "Before you get started"}</h2>
        {doc && (
          <p className="notice notice-warning mt-4">
            {doc.status} Version {doc.version}.
          </p>
        )}

        {doc?.sections.map((section) => (
          <section key={section.heading} className="mt-4">
            <h3 className="card-title">{section.heading}</h3>
            <p className="legal mt-2 mb-0">{section.body}</p>
          </section>
        ))}

        {!doc && !error && <LoadingState label="Loading the notice…" />}

        <label className="choice choice-top">
          <input
            type="checkbox"
            checked={checked}
            disabled={!doc}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            I have read draft {doc?.version || ""} and I accept it so I can use the system. I understand it
            is not a legally approved policy.
          </span>
        </label>

        <button className="btn btn-block mt-4" disabled={!checked || !doc || busy} onClick={handleAccept}>
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
          {user?.consentAccepted ? "Sign out without accepting this version" : "Decline & sign out"}
        </button>
      </div>
    </div>
  );
}
