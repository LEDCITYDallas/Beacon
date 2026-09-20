const config = require("../../config/env");

// ---------------------------------------------------------------------
// In-memory live-view frame bus (Priority 3 / Section 6).
//
// THE PRIVACY CONTRACT, in code:
//   - frames live in a plain in-memory Map, keyed by session id
//   - only the LATEST frame is ever held (no history, no replay)
//   - a frame older than LIVEVIEW_FRAME_TTL_SECONDS is discarded on read
//   - ending a session drops the frame and closes every subscriber
//   - nothing here touches the database, the filesystem, or object storage
//
// There is therefore no recording to leak: a live-view session leaves behind
// only the session LOG row (who viewed whom, when, for how long).
// ---------------------------------------------------------------------

const sessions = new Map(); // sessionId -> { frame, subscribers:Set, lastPublishAt, frames }

function bucket(sessionId) {
  const key = String(sessionId);
  if (!sessions.has(key)) {
    sessions.set(key, { frame: null, subscribers: new Set(), lastPublishAt: 0, frames: 0 });
  }
  return sessions.get(key);
}

function frameExpired(frame) {
  if (!frame) return true;
  return Date.now() - frame.at > config.liveView.frameTtlSeconds * 1000;
}

// Store one frame and push it to every subscribed admin stream.
// Returns { published: true } or { published: false, reason } when throttled.
function publish(sessionId, { buffer, contentType }) {
  const b = bucket(sessionId);
  const now = Date.now();
  if (now - b.lastPublishAt < config.liveView.minFrameIntervalMs) {
    return { published: false, reason: "throttled" };
  }
  b.lastPublishAt = now;
  b.frames += 1;
  b.frame = { buffer, contentType, at: now, seq: b.frames };

  const payload = `event: frame\ndata: ${JSON.stringify({
    seq: b.frames,
    at: now,
    contentType,
    image: buffer.toString("base64"),
  })}\n\n`;

  for (const res of b.subscribers) {
    try {
      res.write(payload);
    } catch {
      b.subscribers.delete(res);
    }
  }

  return { published: true, seq: b.frames };
}

// The most recent frame, or null when it has already expired. Nothing older
// than the TTL is ever handed out.
function latest(sessionId) {
  const b = sessions.get(String(sessionId));
  if (!b || frameExpired(b.frame)) return null;
  return b.frame;
}

function subscribe(sessionId, res) {
  const b = bucket(sessionId);
  b.subscribers.add(res);
  return () => {
    b.subscribers.delete(res);
  };
}

function notify(sessionId, event, data) {
  const b = sessions.get(String(sessionId));
  if (!b) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const res of b.subscribers) {
    try {
      res.write(payload);
    } catch {
      b.subscribers.delete(res);
    }
  }
}

// Drop every trace of the live stream for a session.
function drop(sessionId, { reason = "session ended" } = {}) {
  const key = String(sessionId);
  const b = sessions.get(key);
  if (!b) return;
  notify(key, "ended", { reason });
  for (const res of b.subscribers) {
    try {
      res.end();
    } catch {
      /* already closed */
    }
  }
  sessions.delete(key);
}

function stats() {
  let activeFrames = 0;
  let subscribers = 0;
  for (const b of sessions.values()) {
    if (!frameExpired(b.frame)) activeFrames++;
    subscribers += b.subscribers.size;
  }
  return { sessions: sessions.size, activeFrames, subscribers };
}

// Periodic hygiene: expire held frames even if a session was never explicitly
// ended (for example the admin closed the browser). Keeps no frame around.
function sweepExpired() {
  for (const [key, b] of sessions.entries()) {
    if (b.subscribers.size === 0 && frameExpired(b.frame)) sessions.delete(key);
  }
}

module.exports = { publish, latest, subscribe, notify, drop, stats, sweepExpired };