import React from "react";
import { Navigate, Route, Routes, useLocation, Link } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Consent from "./pages/Consent";
import EmployeeHome from "./pages/EmployeeHome";
import ManagerDashboard from "./pages/ManagerDashboard";
import Assistant from "./pages/Assistant";
import MyScorecard from "./pages/MyScorecard";
import TeamScorecard from "./pages/TeamScorecard";
import LiveView from "./pages/LiveView";
import AdminSettings from "./pages/AdminSettings";
import LiveViewPrompt from "./components/LiveViewPrompt";
import { useIdleHeartbeat } from "./hooks/useIdleHeartbeat";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.consentAccepted && location.pathname !== "/consent") {
    return <Navigate to="/consent" replace />;
  }
  return <>{children}</>;
}

// Section 3: manager/admin pages must not render for employees even via
// direct URL - the API would reject their queries anyway, but don't render
// the shell at all.
function ManagerRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "MANAGER" && user?.role !== "SUPER_ADMIN") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// Admin-only pages must not render for managers or employees even via a direct
// URL - the API rejects their calls anyway, but the shell should not pretend.
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "SUPER_ADMIN") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const isManagerOrAbove = user?.role === "MANAGER" || user?.role === "SUPER_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  // Section 6 idle/AFK: permitted activity signals only (pointer, keyboard
  // events as timestamps, scroll, touch). The server decides Active vs On
  // Break from the idle duration we send - 15-20 minutes, configurable.
  const { presence, offline } = useIdleHeartbeat({ enabled: Boolean(user) });

  const presenceLabel =
    presence === null
      ? ""
      : presence.status === "ACTIVE"
        ? presence.activityConfidence === "CONFIRMED"
          ? "Active"
          : "Active (activity unknown)"
        : "On break / inactive";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>LED City</h2>
        <Link className="nav-link" to="/">
          Home
        </Link>
        <Link className="nav-link" to="/assistant">
          Assistant
        </Link>
        <Link className="nav-link" to="/scorecard">
          My scorecard
        </Link>
        {isManagerOrAbove && (
          <>
            <Link className="nav-link" to="/team">
              Team queue
            </Link>
            <Link className="nav-link" to="/team-scorecard">
              Team scorecard
            </Link>
            <Link className="nav-link" to="/liveview">
              Live view
            </Link>
          </>
        )}
        {isSuperAdmin && (
          <Link className="nav-link" to="/admin">
            Administration
          </Link>
        )}
        <div style={{ marginTop: 40 }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>{user?.name}</p>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 0 }}>
            {user?.role} · {user?.department}
          </p>
          {presence && (
            <p
              style={{
                fontSize: 11,
                marginTop: 6,
                color: presence.status === "ACTIVE" ? "var(--success)" : "var(--warning)",
              }}
            >
              {presenceLabel}
            </p>
          )}
          {offline && (
            <p style={{ fontSize: 11, color: "var(--warning)" }}>Reconnecting…</p>
          )}
          <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        {/* Employee-facing live-view prompt: allow, decline, or stop sharing. */}
        <LiveViewPrompt />
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/consent"
        element={
          <Protected>
            <Consent />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Shell>
              <EmployeeHome />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/assistant"
        element={
          <Protected>
            <Shell>
              <Assistant />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/team"
        element={
          <Protected>
            <ManagerRoute>
              <Shell>
                <ManagerDashboard />
              </Shell>
            </ManagerRoute>
          </Protected>
        }
      />
      <Route
        path="/scorecard"
        element={
          <Protected>
            <Shell>
              <MyScorecard />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/team-scorecard"
        element={
          <Protected>
            <ManagerRoute>
              <Shell>
                <TeamScorecard />
              </Shell>
            </ManagerRoute>
          </Protected>
        }
      />
      <Route
        path="/liveview"
        element={
          <Protected>
            <ManagerRoute>
              <Shell>
                <LiveView />
              </Shell>
            </ManagerRoute>
          </Protected>
        }
      />
      <Route
        path="/admin"
        element={
          <Protected>
            <SuperAdminRoute>
              <Shell>
                <AdminSettings />
              </Shell>
            </SuperAdminRoute>
          </Protected>
        }
      />
    </Routes>
  );
}
