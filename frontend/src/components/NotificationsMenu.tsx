import React, { useCallback, useEffect, useState } from "react";
import client from "../api/client";
import Icon, { IconName } from "./Icon";
import LoadingState from "./LoadingState";
import { useAuth } from "../context/AuthContext";
import { usePopover } from "../hooks/usePopover";
import { relativeFrom } from "../utils/format";

// Read-only view of GET /alerts/notifications: the in-app record of messages
// addressed to the signed-in user. Opening it never sends or changes anything
// on the server. "New" is tracked in this browser only, against the newest
// item the user has already opened the list on.

interface NotificationItem {
  id: string;
  channel: string;
  kind: string;
  subject: string;
  status: string;
  at: string;
}

const KIND_LABEL: Record<string, string> = {
  OVERDUE_ALERT: "Overdue alert",
  BLOCKED_ALERT: "Blocked alert",
  OVERRUN_ALERT: "Estimate overrun",
  DIGEST: "Digest",
  HANDOFF: "Handoff",
  DRAFT_MESSAGE: "Draft message",
  TASK_FLAGGED: "Task flagged",
  ACCOUNT_ACCESS: "Account access",
};

const KIND_ICON: Record<string, IconName> = {
  OVERDUE_ALERT: "clock",
  BLOCKED_ALERT: "alert",
  OVERRUN_ALERT: "clock",
  DIGEST: "mail",
  HANDOFF: "team",
  DRAFT_MESSAGE: "mail",
  TASK_FLAGGED: "flag",
  ACCOUNT_ACCESS: "shield",
};

const CHANNEL_LABEL: Record<string, string> = { IN_APP: "In-app", EMAIL: "Email", WHATSAPP: "WhatsApp" };
const STATUS_LABEL: Record<string, string> = {
  SENT: "Sent",
  SIMULATED: "Simulated",
  QUEUED: "In-app only",
  FAILED: "Failed",
};

function toneFor(item: NotificationItem) {
  if (item.status === "FAILED") return "danger";
  if (item.kind === "OVERDUE_ALERT" || item.kind === "BLOCKED_ALERT" || item.kind === "OVERRUN_ALERT") {
    return "amber";
  }
  return "emerald";
}

function readSeen(key: string) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

export default function NotificationsMenu() {
  const { user } = useAuth();
  const { open, setOpen, wrapRef, triggerRef } = usePopover();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState("");
  const seenKey = `ems.notificationsSeen.${user?.id || "anon"}`;
  const [seenAt, setSeenAt] = useState(() => readSeen(seenKey));

  const load = useCallback(async () => {
    try {
      const res = await client.get("/alerts/notifications", { params: { limit: 20 } });
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
      setError("");
    } catch {
      setError("Notifications could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const newest = (items || []).reduce((max, item) => Math.max(max, new Date(item.at).getTime() || 0), 0);
  const fresh = (items || []).filter((item) => (new Date(item.at).getTime() || 0) > seenAt).length;

  useEffect(() => {
    if (!open || newest <= seenAt) return;
    setSeenAt(newest);
    try {
      localStorage.setItem(seenKey, String(newest));
    } catch {
      /* storage unavailable: the badge just resets next session */
    }
  }, [open, newest, seenAt, seenKey]);

  const panelId = "notifications-panel";

  return (
    <div className="topbar-pop" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="topbar-action"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="topbar-action-label">Notifications</span>
        <span className="topbar-bell">
          <Icon name="bell" />
          {fresh > 0 ? (
            <span className="count-badge" aria-hidden="true">
              {fresh > 9 ? "9+" : fresh}
            </span>
          ) : null}
        </span>
        {fresh > 0 ? <span className="sr-only">, {fresh} new</span> : null}
      </button>
      {open ? (
        <div id={panelId} className="popover popover-wide" role="region" aria-label="Notifications">
          <div className="popover-head">
            <p className="popover-title">Notifications</p>
            {items ? <span className="popover-count">{items.length} recent</span> : null}
          </div>
          {error ? <p className="notice notice-danger">{error}</p> : null}
          {!items && !error ? <LoadingState label="Loading notifications…" /> : null}
          {items && items.length === 0 ? <p className="popover-empty">No notifications yet.</p> : null}
          {items && items.length > 0 ? (
            <ul className="notif-list">
              {items.slice(0, 8).map((item) => (
                <li key={item.id} className="notif-item">
                  <span className={`notif-icon tone-${toneFor(item)}`} aria-hidden="true">
                    <Icon name={KIND_ICON[item.kind] || "bell"} size={16} />
                  </span>
                  <div className="notif-body">
                    <p className="notif-subject">{item.subject || KIND_LABEL[item.kind] || item.kind}</p>
                    <p className="notif-meta">
                      {KIND_LABEL[item.kind] || item.kind} · {CHANNEL_LABEL[item.channel] || item.channel} ·{" "}
                      {STATUS_LABEL[item.status] || item.status} ·{" "}
                      <time dateTime={item.at}>{relativeFrom(item.at)}</time>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="popover-foot">Messages addressed to you. Opening this list does not send anything.</p>
        </div>
      ) : null}
    </div>
  );
}
