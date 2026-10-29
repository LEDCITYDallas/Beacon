import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import { BrandGlyph, BrandWordmark } from "../components/Brand";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.response?.data?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <div className="auth-brand">
          <BrandGlyph size={52} />
          <BrandWordmark />
        </div>
        <form onSubmit={handleSubmit}>
          <h2 className="page-title">Welcome back</h2>
          <p className="auth-lede">Sign in to see what's next.</p>

          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="username"
            required
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />

          {error && <p className="notice notice-danger">{error}</p>}

          <button className="btn btn-block mt-4" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <ForgotPassword email={email} />
      </div>
    </div>
  );
}

function ForgotPassword({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(email);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.MouseEvent) {
    event.preventDefault();
    setBusy(true);
    setNote("");
    try {
      const res = await client.post("/auth/forgot-password", { email: address });
      setNote(res.data.message);
    } catch (err: any) {
      setNote(err.response?.data?.message || "Could not request a reset.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-outline btn-block mt-3" onClick={() => {
        setAddress(email);
        setOpen(true);
      }}>
        Forgot password?
      </button>
    );
  }

  return (
    <div className="mt-4">
      <p className="list-meta">
        A reset email is sent only when a live mailbox is configured. Otherwise an administrator issues the link.
      </p>
      <label htmlFor="forgot-email">Email</label>
      <input id="forgot-email" type="email" value={address} onChange={(event) => setAddress(event.target.value)} required />
      {note && <p className="notice">{note}</p>}
      <button type="button" className="btn btn-outline btn-block mt-3" disabled={busy} onClick={submit}>
        {busy ? "Requesting…" : "Request reset email"}
      </button>
    </div>
  );
}
