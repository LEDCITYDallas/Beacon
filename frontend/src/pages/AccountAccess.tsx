import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { BrandGlyph, BrandWordmark } from "../components/Brand";

// Public page for a one-time setup or reset link. The token arrives in the
// URL hash, which is not sent to the server as a query string, and is removed
// from the address bar as soon as the page reads it.
export default function AccountAccess({ purpose }: { purpose: "setup" | "reset" }) {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromHash = window.location.hash.startsWith("#token=")
      ? decodeURIComponent(window.location.hash.slice("#token=".length))
      : "";
    let saved = "";
    try {
      saved = sessionStorage.getItem("ems.accessToken") || "";
    } catch {
      saved = "";
    }
    const next = fromHash || saved;
    if (fromHash) {
      try {
        sessionStorage.setItem("ems.accessToken", fromHash);
      } catch {
        /* the form can still use the hash on this load */
      }
    }
    setToken(next);
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await client.post(purpose === "setup" ? "/auth/setup" : "/auth/reset-password", {
        token,
        password,
      });
      setDone(true);
      setPassword("");
      setConfirm("");
      try {
        sessionStorage.removeItem("ems.accessToken");
      } catch {
        /* storage unavailable */
      }
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : "";
      setError(message || "This link could not be used.");
    } finally {
      setBusy(false);
    }
  }

  const title = purpose === "setup" ? "Set up your account" : "Choose a new password";

  return (
    <div className="auth-shell">
      <form onSubmit={handleSubmit} className="card auth-card">
        <div className="auth-brand">
          <BrandGlyph size={52} />
          <BrandWordmark />
        </div>
        <h2 className="page-title">{title}</h2>
        {done ? (
          <>
            <p className="notice notice-success">Password saved. Sign in with your email and new password.</p>
            <Link className="btn btn-block mt-4" to="/login">
              Go to sign in
            </Link>
          </>
        ) : !token ? (
          <>
            <p className="list-meta">
              This page needs the one-time link from an administrator. Email invitations are not sent until a
              mailbox is configured.
            </p>
            <Link className="btn btn-block mt-4" to="/login">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="list-meta mb-4">
              Choose a password of at least 10 characters. This link works once.
            </p>
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
            />
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
              minLength={10}
            />
            {error && <p className="notice notice-danger">{error}</p>}
            <button className="btn btn-block mt-4" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
