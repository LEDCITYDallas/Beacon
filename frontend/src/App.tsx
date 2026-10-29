import React, { useEffect, useState } from "react";
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
import AccountAccess from "./pages/AccountAccess";
import LiveViewPrompt from "./components/LiveViewPrompt";
import LoadingState from "./components/LoadingState";
import Icon from "./components/Icon";
import { BrandGlyph, BrandWordmark } from "./components/Brand";
import TopbarSearch, { SearchPage } from "./components/TopbarSearch";
import NotificationsMenu from "./components/NotificationsMenu";
import AccountMenu from "./components/AccountMenu";
import { notify } from "./components/Toaster";
import { confirmAction } from "./components/ConfirmDialog";
import { useIdleHeartbeat } from "./hooks/useIdleHeartbeat";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-shell">
        <LoadingState label="Loading your session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!user.consentCurrent && location.pathname !== "/consent") {
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

interface NavEntry extends SearchPage {
  scope: "all" | "manager" | "admin";
  group: "workspace" | "team" | "system";
}

// Role-gated navigation. The same list feeds the sidebar and the top-bar
// search, so search never offers a page the route guards would bounce.
const NAV: NavEntry[] = [
  {
    to: "/",
    label: "Dashboard",
    icon: "dashboard",
    keywords: "home today queue now up next week calendar",
    scope: "all",
    group: "workspace",
  },
  {
    to: "/assistant",
    label: "Assistant",
    icon: "assistant",
    keywords: "chat ask help draft approvals",
    scope: "all",
    group: "workspace",
  },
  {
    to: "/scorecard",
    label: "My scorecard",
    icon: "scorecard",
    keywords: "score stats week trend",
    scope: "all",
    group: "workspace",
  },
  {
    to: "/team",
    label: "Team queue",
    icon: "team",
    keywords: "tasks people flag reopen alerts new task overdue blocked",
    scope: "manager",
    group: "team",
  },
  {
    to: "/team-scorecard",
    label: "Team scorecard",
    icon: "analytics",
    keywords: "ratings scores departments",
    scope: "manager",
    group: "team",
  },
  {
    to: "/liveview",
    label: "Live view",
    icon: "live",
    keywords: "screen view request session",
    scope: "manager",
    group: "team",
  },
  {
    to: "/admin",
    label: "Administration",
    icon: "settings",
    keywords: "settings staff accounts audit retention digest integrations weights",
    scope: "admin",
    group: "system",
  },
];

const NAV_GROUPS: { key: NavEntry["group"]; label: string }[] = [
  { key: "workspace", label: "Workspace" },
  { key: "team", label: "Team" },
  { key: "system", label: "System" },
];

const PAGE_LABELS: Record<string, string> = Object.fromEntries(NAV.map((entry) => [entry.to, entry.label]));

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, withdrawConsent } = useAuth();
  const isManagerOrAbove = user?.role === "MANAGER" || user?.role === "SUPER_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  // Section 6 idle/AFK: permitted activity signals only (pointer, keyboard
  // events as timestamps, scroll, touch). The server decides Active vs On
  // Break from the idle duration we send - 15-20 minutes, configurable.
  const { presence, offline } = useIdleHeartbeat({ enabled: Boolean(user?.consentCurrent) });

  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    if (location.pathname === "/assistant") return;
    const known = ["/", "/scorecard", "/team", "/team-scorecard", "/liveview", "/admin"];
    if (!known.includes(location.pathname)) return;
    try {
      sessionStorage.setItem("ems.lastScreen", location.pathname);
    } catch {
      /* storage unavailable */
    }
  }, [location.pathname]);

  useEffect(() => {
    const page = PAGE_LABELS[location.pathname];
    document.title = page ? `${page} · LED City Workforce` : "LED City Workforce Assistant";
    return () => {
      document.title = "LED City Workforce Assistant";
    };
  }, [location.pathname]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

  const [lightTheme, setLightTheme] = useState(
    () => typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
  );

  const entries = NAV.filter(
    (entry) =>
      entry.scope === "all" ||
      (entry.scope === "manager" && isManagerOrAbove) ||
      (entry.scope === "admin" && isSuperAdmin)
  );

  function withdraw() {
    void confirmAction(
      "Withdraw consent and sign out? Tasks, time logs, and the audit record stay. You cannot use the system until you accept again."
    ).then((ok) => {
      if (!ok) return;
      withdrawConsent().catch(() => {
        notify("error", "Could not record the withdrawal. You are still signed in.");
      });
    });
  }

  function item(entry: NavEntry) {
    const active = location.pathname === entry.to;
    return (
      <Link
        key={entry.to}
        className={active ? "nav-link active" : "nav-link"}
        to={entry.to}
        aria-current={active ? "page" : undefined}
        data-label={entry.label}
      >
        <Icon name={entry.icon} />
        <span className="nav-label">{entry.label}</span>
      </Link>
    );
  }

  return (
    <div className={`app-shell${collapsed ? " is-collapsed" : ""}${navOpen ? " nav-open" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <button
        type="button"
        className="nav-backdrop"
        aria-label="Close navigation"
        onClick={() => setNavOpen(false)}
      />
      <div className="frame">
        <aside className="sidebar" aria-label="Application">
          <div className="sidebar-top">
            <Link className="brand" to="/" aria-label="LED City Workforce dashboard">
              <BrandGlyph />
              <BrandWordmark />
            </Link>
            <button
              type="button"
              className="icon-btn sidebar-close"
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <nav className="sidebar-nav" aria-label="Primary">
            {NAV_GROUPS.map((group) => {
              const items = entries.filter((entry) => entry.group === group.key);
              if (items.length === 0) return null;
              return (
                <div key={group.key} className="nav-group" role="group" aria-label={group.label}>
                  {items.map(item)}
                </div>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            <button type="button" className="side-action side-action-danger" data-label="Withdraw consent" onClick={withdraw}>
              <Icon name="shield" />
              <span className="nav-label">Withdraw consent</span>
            </button>
            <button
              type="button"
              className="side-action collapse-btn"
              onClick={toggleCollapsed}
              aria-pressed={collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              data-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icon name={collapsed ? "expand" : "collapse"} />
              <span className="nav-label">Collapse</span>
            </button>
          </div>
        </aside>
        <div className="shell-main">
          <header className="topbar">
            <button
              type="button"
              className="icon-btn menu-btn"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <TopbarSearch pages={entries} />
            <div className="topbar-actions">
              {offline ? (
                <span className="pill pill-warning topbar-offline" role="status">
                  Reconnecting…
                </span>
              ) : null}
              <button
                type="button"
                className="icon-btn theme-btn"
                onClick={() => {
                  toggleTheme();
                  setLightTheme(document.documentElement.dataset.theme === "light");
                }}
                aria-label={lightTheme ? "Switch to dark theme" : "Switch to light theme"}
                title={lightTheme ? "Switch to dark theme" : "Switch to light theme"}
              >
                <Icon name={lightTheme ? "moon" : "sun"} />
              </button>
              <AccountMenu presence={presence} offline={offline} />
              <NotificationsMenu />
              <button type="button" className="topbar-action" onClick={logout}>
                <span className="topbar-action-label">Sign out</span>
                <Icon name="power" />
              </button>
            </div>
          </header>
          <main className="main" id="main-content" tabIndex={-1}>
            <LiveViewPrompt />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<AccountAccess purpose="setup" />} />
      <Route path="/reset" element={<AccountAccess purpose="reset" />} />
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
