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
import Avatar from "./components/Avatar";
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

// Section 2: dark theme by default, light-mode toggle available. The light
// palette lives in theme.css ([data-theme="light"]); this only flips the
// attribute and remembers the choice. Dark stays the default when unset.
if (typeof window !== "undefined") {
  try {
    if (localStorage.getItem("theme") === "light") {
      document.documentElement.dataset.theme = "light";
    }
  } catch {
    /* storage unavailable - dark default */
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const toLight = root.dataset.theme !== "light";
  if (toLight) root.dataset.theme = "light";
  else delete root.dataset.theme;
  try {
    localStorage.setItem("theme", toLight ? "light" : "dark");
  } catch {
    /* storage unavailable */
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const isManagerOrAbove = user?.role === "MANAGER" || user?.role === "SUPER_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  // Section 6 idle/AFK: permitted activity signals only (pointer, keyboard
  // events as timestamps, scroll, touch). The server decides Active vs On
  // Break from the idle duration we send - 15-20 minutes, configurable.
  const { presence, offline } = useIdleHeartbeat({ enabled: Boolean(user) });

  // Nav highlight is derived from the current route (no routing change - the
  // same paths, just so the active item is visible).
  const location = useLocation();
  const navClass = (to: string) => (location.pathname === to ? "nav-link active" : "nav-link");

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
        <p className="brand">LED City</p>
        <p className="nav-section">Workspace</p>
        <Link className={navClass("/")} to="/">
          Home
        </Link>
        <Link className={navClass("/assistant")} to="/assistant">
          Assistant
        </Link>
        <Link className={navClass("/scorecard")} to="/scorecard">
          My scorecard
        </Link>
        {isManagerOrAbove && (
          <>
            <p className="nav-section">Team</p>
            <Link className={navClass("/team")} to="/team">
              Team queue
            </Link>
            <Link className={navClass("/team-scorecard")} to="/team-scorecard">
              Team scorecard
            </Link>
            <Link className={navClass("/liveview")} to="/liveview">
              Live view
            </Link>
          </>
        )}
        {isSuperAdmin && (
          <>
            <p className="nav-section">System</p>
            <Link className={navClass("/admin")} to="/admin">
              Administration
            </Link>
          </>
        )}
        <div className="sidebar-foot">
          <div className="user-chip">
            <Avatar name={user?.name || "?"} size="sm" />
            <div className="user-chip-body">
              <p className="user-chip-name">{user?.name}</p>
              <p className="user-chip-meta">
                {user?.role} · {user?.department}
              </p>
            </div>
          </div>
          {presence && (
            <p
              className={`status-line mt-2 ${
                presence.status === "ACTIVE" ? "status-line-active" : "status-line-break"
              }`}
            >
              {presenceLabel}
            </p>
          )}
          {offline && <p className="text-micro status-line-break mb-0">Reconnecting…</p>}
          <div className="row mt-3">
            <button
              className="btn btn-outline btn-sm flex-1"
              onClick={toggleTheme}
              title="Switch between dark and light theme"
            >
              Theme
            </button>
            <button className="btn btn-outline btn-sm flex-1" onClick={logout}>
              Sign out
            </button>
          </div>
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
