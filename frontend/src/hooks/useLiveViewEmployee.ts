import { useCallback, useEffect, useRef, useState } from "react";
import client from "../api/client";

// ---------------------------------------------------------------------
// Employee side of live screen view (Priority 3 / Section 6).
//
// The employee is prompted when an administrator requests a view, and MUST
// allow it before a single frame is captured - which also satisfies the
// browser's own requirement for a user gesture before screen sharing starts.
//
// V2 is view-only:
//   - the stream is read from getDisplayMedia and encoded in memory
//   - frames are POSTed to the server's in-memory bus and then discarded
//   - nothing is written to disk, and ending the session stops the capture
//   - the employee can stop sharing at any moment (the browser's own control
//     and the "Stop sharing" button both end the session)
// ---------------------------------------------------------------------

export interface PendingRequest {
  id: string;
  viewerName: string;
  viewerRole: string;
  reason: string;
  requestedAt: string;
  expiresInSeconds: number;
}

export interface ActiveSession {
  id: string;
  viewerName: string;
  startedAt: string;
  framesSent: number;
}

const POLL_MS = 20000;
const FRAME_INTERVAL_MS = 1000;
const MAX_WIDTH = 960;
const JPEG_QUALITY = 0.55;

export function useLiveViewEmployee() {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [framesSent, setFramesSent] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const activeIdRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await client.get("/liveview/sessions/for-me");
      setPending(res.data.pending);
      setActive(res.data.active);
      activeIdRef.current = res.data.active ? res.data.active.id : null;
    } catch {
      /* transient - the next poll retries */
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const stopSharing = useCallback(
    async (endOnServer = true) => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setSharing(false);
      const sessionId = activeIdRef.current;
      activeIdRef.current = null;
      if (endOnServer && sessionId) {
        try {
          await client.post(`/liveview/sessions/${sessionId}/end`, { reason: "employee stopped sharing" });
        } catch {
          /* already ended */
        }
      }
      poll();
    },
    [poll]
  );

  // Capture loop: canvas -> JPEG -> POST. Everything stays in memory.
  const startSharing = useCallback(async () => {
    setError("");
    if (!active) {
      setError("No active live-view session to share with.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 4 },
        audio: false, // audio is never captured
      });
      streamRef.current = stream;

      // If the employee stops sharing from the browser's own toolbar, end the
      // session too - the admin must not keep a "live" view of nothing.
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        void stopSharing(true);
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      setSharing(true);
      setFramesSent(0);

      timerRef.current = window.setInterval(async () => {
        const sessionId = activeIdRef.current;
        if (!sessionId || !ctx) return;
        try {
          const scale = Math.min(1, MAX_WIDTH / (video.videoWidth || MAX_WIDTH));
          canvas.width = Math.max(1, Math.round((video.videoWidth || MAX_WIDTH) * scale));
          canvas.height = Math.max(1, Math.round((video.videoHeight || 540) * scale));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          const image = dataUrl.split(",")[1];
          await client.post(`/liveview/sessions/${sessionId}/frames`, {
            image,
            contentType: "image/jpeg",
          });
          setFramesSent((n) => n + 1);
        } catch (err: any) {
          if (err.response?.status === 409 || err.response?.status === 403) {
            void stopSharing(false);
          }
        }
      }, FRAME_INTERVAL_MS);
    } catch (err: any) {
      setError(err?.message || "Screen sharing was not started.");
      setSharing(false);
    }
  }, [active, stopSharing]);

  const approve = useCallback(
    async (sessionId: string) => {
      await client.post(`/liveview/sessions/${sessionId}/approve`);
      await poll();
      // The employee still presses "Start sharing" - that click is also what
      // lets the browser hand over the screen, and it keeps the consent
      // explicit at the moment of capture.
      return true;
    },
    [poll]
  );

  const deny = useCallback(
    async (sessionId: string) => {
      await client.post(`/liveview/sessions/${sessionId}/deny`);
      await poll();
    },
    [poll]
  );

  return {
    pending,
    active,
    sharing,
    framesSent,
    error,
    approve,
    deny,
    startSharing,
    stopSharing,
    refresh: poll,
    notice: "Live view is view-only: your screen is never recorded, saved or turned into a screenshot.",
  };
}