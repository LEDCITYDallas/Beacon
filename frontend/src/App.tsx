import React from "react";
import { Navigate, Route, Routes, useLocation, Link } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Consent from "./pages/Consent";
import EmployeeHome from "./pages/EmployeeHome";
import ManagerDashboard from "./pages/ManagerDashboard";
import Assistant from "./pages/Assistant";

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

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const isManagerOrAbove = user?.role === "MANAGER" || user?.role === "SUPER_ADMIN";

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
        {isManagerOrAbove && (
          <Link className="nav-link" to="/team">
            Team queue
          </Link>
        )}
        <div style={{ marginTop: 40 }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{user?.name}</p>
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{user?.role}</p>
          <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
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
    </Routes>
  );
}
