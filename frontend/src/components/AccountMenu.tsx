import React from "react";
import Avatar from "./Avatar";
import { useAuth } from "../context/AuthContext";
import { usePopover } from "../hooks/usePopover";
import { PresenceState } from "../hooks/useIdleHeartbeat";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

export function presenceText(presence: PresenceState | null) {
  if (!presence) return "";
  if (presence.status !== "ACTIVE") return "On break / inactive";
  return presence.activityConfidence === "CONFIRMED" ? "Active" : "Active (activity unknown)";
}

// Avatar button in the top bar. The dot mirrors the same heartbeat state the
// server records (Section 6); the panel spells it out in words.
export default function AccountMenu({
  presence,
  offline,
}: {
  presence: PresenceState | null;
  offline: boolean;
}) {
  const { user } = useAuth();
  const { open, setOpen, wrapRef, triggerRef } = usePopover();
  const status = offline ? "Reconnecting…" : presenceText(presence) || "Checking status…";
  const dot = offline ? "is-offline" : !presence ? "is-unknown" : presence.status === "ACTIVE" ? "is-active" : "is-away";
  const panelId = "account-panel";

  return (
    <div className="topbar-pop" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${user?.name || "signed in"}, ${status}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar name={user?.name || "?"} size="lg" />
        <span className={`presence-dot ${dot}`} aria-hidden="true" />
      </button>
      {open ? (
        <div id={panelId} className="popover" role="region" aria-label="Account">
          <div className="account-head">
            <Avatar name={user?.name || "?"} size="lg" />
            <div className="account-id">
              <p className="account-name">{user?.name}</p>
              <p className="account-meta">{user?.email}</p>
            </div>
          </div>
          <dl className="account-facts">
            <div>
              <dt>Role</dt>
              <dd>{ROLE_LABEL[user?.role || ""] || user?.role}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{user?.department || "—"}</dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>{user?.timezone || "—"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className={`status-line ${dot === "is-active" ? "status-line-active" : "status-line-break"}`}>
                {status}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
