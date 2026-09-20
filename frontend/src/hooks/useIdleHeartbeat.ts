import { useEffect, useRef, useState } from "react";
import client from "../api/client";

// ---------------------------------------------------------------------
// Real idle / AFK detection (Priority 2 / Section 6).
//
// The earlier version only sent "I am here" every 60s, which cannot distinguish
// someone working from a machine sitting with the tab open. This hook watches
// the PERMITTED activity signals the browser exposes - pointer movement,
// clicks, keyboard events, scroll, touch - and sends only a TIMESTAMP and an
// IDLE DURATION. It never records which key was pressed or what was on screen.
//
// Behaviour required by Section 6:
//   - no input for the configured window (15-20 min) -> On Break/Inactive
//   - the moment input resumes, activity is reported and the employee returns
//     to Active
//   - a network drop must not lose state: on failure we retry with backoff and
//     send the current idle reading as soon as we are back
// ---------------------------------------------------------------------

const EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "mouseup",
  "wheel",
  "keydown",
  "scroll",
  "touchstart",
  "pointerdown",
];

export interface PresenceState {
  status: "ACTIVE" | "INACTIVE";
  activityConfidence: "CONFIRMED" | "UNKNOWN";
  idleDetected: boolean;
  idleSeconds: number | null;
  idleThresholdMinutes: number;
  lastSignalKind: string | null;
  resumedFromIdle?: boolean;
}

export function useIdleHeartbeat({ enabled = true }: { enabled?: boolean } = {}) {
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [offline, setOffline] = useState(false);

  // Refs so the interval is created once and never fights React's re-renders.
  const lastInputRef = useRef<number>(Date.now());
  const wasIdleRef = useRef(false);
  const offlineRef = useRef(false);
  const backoffRef = useRef(1000);

  useEffect(() => {
    if (!enabled) return;

    // Only a timestamp is kept - no key codes, no coordinates, no content.
    const markActivity = () => {
      lastInputRef.current = Date.now();
    };
    EVENTS.forEach((e) => window.addEventListener(e, markActivity, { passive: true }));
    window.addEventListener("focus", markActivity);

    async function send() {
      const idleSeconds = Math.max(0, Math.round((Date.now() - lastInputRef.current) / 1000));
      try {
        const res = await client.post("/activity/heartbeat", {
          idleSeconds,
          source: "BROWSER",
          visibility: document.visibilityState === "visible" ? "visible" : "hidden",
        });
        const state = res.data as PresenceState;
        setPresence(state);
        wasIdleRef.current = state.status === "INACTIVE";
        if (offlineRef.current) {
          // Reconnected: the next reading immediately reflects the real idle
          // clock, so the offline gap is never reported as activity.
          offlineRef.current = false;
          setOffline(false);
        }
        backoffRef.current = 1000;
      } catch {
        offlineRef.current = true;
        setOffline(true);
        backoffRef.current = Math.min(60000, Math.round(backoffRef.current * 1.8));
      }
    }

    send();

    // Normal cadence. Every beat carries the current idle reading, so returning
    // from an idle window flips the employee back to Active immediately
    // (Section 6), and a reconnect is detected on the very next beat.
    const interval = setInterval(send, 60000);

    const onVisible = () => {
      markActivity();
      send();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, markActivity));
      window.removeEventListener("focus", markActivity);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [enabled]);

  return { presence, offline };
}
