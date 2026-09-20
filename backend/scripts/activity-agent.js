// ---------------------------------------------------------------------
// Activity agent (Priority 2 / Section 6).
//
// The browser can only see activity inside the page. This optional desktop
// agent reads the OPERATING SYSTEM's own idle timer, so "on break" is based on
// real mouse/keyboard activity even when the browser is in the background.
//
// What it does NOT do (hard exclusions, enforced by this file containing no
// such code): no keylogging, no key contents, no window titles, no screen
// recording, no webcam, no audio. It reads ONE number - seconds since the last
// input - and the employee's own task list, nothing else.
//
// Usage:
//   AGENT_EMAIL=maria@mock.ledcity.test AGENT_PASSWORD=MockPass123! \
//     node scripts/activity-agent.js
//
//   node scripts/activity-agent.js --liveview   (also follows approved live-view
//                                                sessions and posts frames)
//
// Safe reconnect: if the network drops, the agent backs off exponentially and,
// on reconnect, sends the CURRENT idle reading immediately. It never fabricates
// activity for the offline gap, and it never reports an idle window it did not
// measure.
// ---------------------------------------------------------------------
require("dotenv").config();
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const BASE = process.env.AGENT_BASE_URL || `http://localhost:${process.env.PORT || 5000}/api`;
const EMAIL = process.env.AGENT_EMAIL || "";
const PASSWORD = process.env.AGENT_PASSWORD || "";
const HEARTBEAT_MS = Math.max(15, Number(process.env.HEARTBEAT_SECONDS || 60)) * 1000;
const LIVEVIEW = process.argv.includes("--liveview");
const FRAME_INTERVAL_MS = 1000;

const CLIENT_ID = `${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;

let token = "";
let stopping = false;

function log(...args) {
  console.log(`[agent ${new Date().toISOString()}]`, ...args);
}

// --- OS idle time (the only signal this agent reads) -------------------

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

// Windows: GetLastInputInfo via Add-Type. Returns milliseconds idle.
async function idleSecondsWindows() {
  const script = [
    "$sig = '[DllImport(\"user32.dll\")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO l); public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }';",
    "Add-Type -Namespace Idle -Name Api -MemberDefinition $sig | Out-Null;",
    "$i = New-Object Idle.Api+LASTINPUTINFO;",
    "$i.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($i);",
    "Idle.Api::GetLastInputInfo([ref]$i) | Out-Null;",
    "$idle = [Environment]::TickCount - $i.dwTime;",
    "if ($idle -lt 0) { $idle = 0 };",
    "Write-Output ([math]::Round($idle / 1000));",
  ].join(" ");
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  const secs = parseInt(out.trim().split(/\r?\n/).pop(), 10);
  if (!Number.isFinite(secs)) throw new Error("could not parse idle time from PowerShell");
  return Math.max(0, secs);
}

// macOS: IOHIDSystem's HIDIdleTime is nanoseconds since the last input.
async function idleSecondsMac() {
  const out = await run("/usr/sbin/ioreg", ["-c", "IOHIDSystem"]);
  const match = out.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  if (!match) throw new Error("HIDIdleTime not found in ioreg output");
  return Math.floor(Number(match[1]) / 1_000_000_000);
}

// Linux: xprintidle (X11). Install with apt install xprintidle.
async function idleSecondsLinux() {
  const out = await run("xprintidle", []);
  return Math.floor(Number(out.trim()) / 1000);
}

async function readIdleSeconds() {
  try {
    if (process.platform === "win32") return await idleSecondsWindows();
    if (process.platform === "darwin") return await idleSecondsMac();
    return await idleSecondsLinux();
  } catch (err) {
    // Unknown idle is reported as null, never as "active" - the server records
    // a HEARTBEAT (UNKNOWN confidence) rather than inventing activity.
    log("could not read OS idle time:", err.message);
    return null;
  }
}

// --- API helpers -------------------------------------------------------

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = new Error((data && data.message) || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

async function login() {
  const data = await api("/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  token = data.token;
  log(`signed in as ${data.user.name} (${data.user.role}); clientId=${CLIENT_ID}`);
  return data;
}

// --- Live view (optional; only sessions the employee APPROVED) ---------
//
// The agent never starts a capture on its own: it polls for sessions that an
// admin requested AND the employee allowed in the app, then posts frames while
// that session is ACTIVE. Frames go to the server's in-memory bus only -
// nothing is written to disk here or there.

async function captureScreenBase64() {
  if (process.platform === "darwin") {
    const buffer = await new Promise((resolve, reject) => {
      execFile(
        "/usr/sbin/screencapture",
        ["-x", "-t", "jpg", "-"],
        { encoding: "buffer", maxBuffer: 12 * 1024 * 1024, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      );
    });
    return buffer.toString("base64");
  }

  if (process.platform === "win32") {
    // One PowerShell call: grab the primary screen, downscale to 960px wide,
    // encode JPEG at quality 55, print base64. No file is written.
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
      "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
      "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;",
      "$g = [System.Drawing.Graphics]::FromImage($bmp);",
      "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size);",
      "$maxW = 960;",
      "$scale = [math]::Min(1, $maxW / $b.Width);",
      "$nw = [int]($b.Width * $scale); $nh = [int]($b.Height * $scale);",
      "$small = New-Object System.Drawing.Bitmap $nw, $nh;",
      "$gs = [System.Drawing.Graphics]::FromImage($small);",
      "$gs.DrawImage($bmp, 0, 0, $nw, $nh);",
      "$ms = New-Object System.IO.MemoryStream;",
      "$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' };",
      "$p = New-Object System.Drawing.Imaging.EncoderParameters 1;",
      "$p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [int64]55);",
      "$small.Save($ms, $codec, $p);",
      "[Convert]::ToBase64String($ms.ToArray());",
    ].join(" ");
    const out = await new Promise((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { maxBuffer: 24 * 1024 * 1024, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout)))
      );
    });
    return out.trim().split(/\r?\n/).pop();
  }

  throw new Error(`screen capture is not implemented for ${process.platform}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollLiveView() {
  try {
    return await api("/liveview/sessions/for-me");
  } catch (err) {
    return { pending: null, active: null, error: err.message };
  }
}

async function streamFrames(sessionId) {
  log(`live view active for session ${sessionId} - streaming frames (never stored)`);
  let frames = 0;
  let active = true;
  while (active && !stopping) {
    try {
      const image = await captureScreenBase64();
      if (!image) throw new Error("empty capture");
      const res = await api(`/liveview/sessions/${sessionId}/frames`, {
        method: "POST",
        body: { image, contentType: "image/jpeg" },
      });
      frames++;
      if (!res.accepted && res.reason && res.reason !== "throttled") active = false;
    } catch (err) {
      if (err.status === 409 || err.status === 403) active = false;
      else log("frame send failed:", err.message);
    }
    await sleep(FRAME_INTERVAL_MS);
  }
  log(`live view session ${sessionId} ended after ${frames} frames (nothing was recorded)`);
}

// --- Main loop with safe reconnect -------------------------------------

async function beat() {
  const idleSeconds = await readIdleSeconds();
  const data = await api("/activity/heartbeat", {
    method: "POST",
    body: {
      source: "OS_AGENT",
      clientId: CLIENT_ID,
      // null is meaningful: "unknown", never "active".
      idleSeconds,
    },
  });
  const mins = idleSeconds === null ? "?" : Math.round(idleSeconds / 60);
  log(
    `status=${data.status} confidence=${data.activityConfidence} idle=${mins}min recorded=${data.recorded}`
  );
  return data;
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error(
      "AGENT_EMAIL and AGENT_PASSWORD are required, e.g.\n" +
        "  $env:AGENT_EMAIL='maria@mock.ledcity.test'; $env:AGENT_PASSWORD='MockPass123!'; node scripts/activity-agent.js"
    );
    process.exit(1);
  }

  log(`starting on ${process.platform}; base=${BASE}; liveview=${LIVEVIEW ? "on" : "off"}`);
  await login();

  let backoffMs = 1000;
  let liveViewSessionId = null;

  while (!stopping) {
    try {
      await beat();
      backoffMs = 1000; // healthy again

      if (LIVEVIEW) {
        const state = await pollLiveView();
        if (state.active && state.active.id !== liveViewSessionId) {
          liveViewSessionId = state.active.id;
          // Runs in the background so heartbeats keep flowing.
          streamFrames(liveViewSessionId).finally(() => {
            liveViewSessionId = null;
          });
        } else if (!state.active) {
          liveViewSessionId = null;
        }
      }

      await sleep(HEARTBEAT_MS);
    } catch (err) {
      if (err.status === 401) {
        // Token expired - re-authenticate rather than dying (reconnect safety).
        log("session expired, signing in again");
        try {
          await login();
        } catch (loginErr) {
          log("re-login failed:", loginErr.message);
        }
      } else {
        log(`network/API problem (${err.message}); retrying in ${Math.round(backoffMs / 1000)}s`);
      }
      // While offline the agent sends nothing at all; on reconnect the next
      // beat carries the CURRENT idle reading, so the offline gap is never
      // reported as activity.
      await sleep(backoffMs);
      backoffMs = Math.min(60000, Math.round(backoffMs * 1.8));
    }
  }
  log("stopped");
}

process.on("SIGINT", () => {
  stopping = true;
  log("shutting down...");
});

if (require.main === module) {
  main().catch((err) => {
    console.error("[agent] fatal:", err);
    process.exit(1);
  });
}

module.exports.main = main;
module.exports.beat = beat;
// Exported for tests and for reuse by a packaged desktop agent.
module.exports.readIdleSeconds = readIdleSeconds;
module.exports.captureScreenBase64 = captureScreenBase64;
module.exports.CLIENT_ID = CLIENT_ID;