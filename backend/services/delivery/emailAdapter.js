const config = require("../../config/env");

// ---------------------------------------------------------------------
// Email delivery adapter (Priority 5 / Section 8).
//
// Transports:
//   mock  (default)  records what WOULD be sent; nothing leaves the machine.
//   smtp             real SMTP via nodemailer - the LED City mailbox
//                    credentials Omair supplies (SMTP_HOST/USER/PASS...).
//   http             a real HTTP email API (EMAIL_HTTP_URL + token), for
//                    providers that expose one instead of SMTP.
//
// Master switch: NOTIFY_DRIVER must be "live" for any real transmission, so
// during development nothing can be sent by accident even if credentials for
// the mailbox exist in the environment.
//
// Return contract (never throws - the caller decides what to do):
//   { driver, status: SENT | SIMULATED | FAILED | SKIPPED_NO_ADDRESS, error, messageId }
// ---------------------------------------------------------------------

let nodemailerLib;
let nodemailerChecked = false;

function nodemailer() {
  if (!nodemailerChecked) {
    nodemailerChecked = true;
    try {
      // Optional dependency: the app must still run without it.
      nodemailerLib = require("nodemailer");
    } catch {
      nodemailerLib = null;
    }
  }
  return nodemailerLib;
}

function transportName() {
  return config.notifications.email.transport;
}

function isTransportConfigured() {
  const t = transportName();
  if (t === "smtp") return Boolean(config.notifications.email.smtp.host);
  if (t === "http") return Boolean(config.notifications.email.http.url);
  return true; // mock always "works"
}

function isLive() {
  return config.notifications.driver === "live" && transportName() !== "mock" && isTransportConfigured();
}

function describe() {
  return {
    channel: "EMAIL",
    transport: transportName(),
    live: isLive(),
    configured: isTransportConfigured(),
    from: config.notifications.email.from,
    masterSwitch: config.notifications.driver,
  };
}

function simulated(to, subject) {
  console.log(`[delivery:email:mock] would send to ${to}: ${subject}`);
  return { driver: "mock", status: "SIMULATED", error: "", messageId: "" };
}

async function sendViaSmtp({ to, subject, text }) {
  const mailer = nodemailer();
  if (!mailer) {
    return {
      driver: "smtp",
      status: "FAILED",
      error: "nodemailer is not installed on the server (npm install nodemailer)",
      messageId: "",
    };
  }
  const { host, port, secure, user, pass } = config.notifications.email.smtp;
  const transport = mailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
  const info = await transport.sendMail({
    from: config.notifications.email.from,
    to,
    subject,
    text,
  });
  return { driver: "smtp", status: "SENT", error: "", messageId: info.messageId || "" };
}

async function sendViaHttp({ to, subject, text }) {
  const { url, token } = config.notifications.email.http;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        from: config.notifications.email.from,
        to,
        subject,
        text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        driver: "http",
        status: "FAILED",
        error: `HTTP ${res.status} ${body.slice(0, 200)}`,
        messageId: "",
      };
    }
    return { driver: "http", status: "SENT", error: "", messageId: "" };
  } catch (err) {
    return {
      driver: "http",
      status: "FAILED",
      error: err.name === "AbortError" ? "email API timed out" : err.message,
      messageId: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function send({ to, subject, text }) {
  if (!to || !String(to).trim()) {
    return { driver: "none", status: "SKIPPED_NO_ADDRESS", error: "no recipient address", messageId: "" };
  }
  if (!isLive()) return simulated(to, subject);

  try {
    if (transportName() === "smtp") return await sendViaSmtp({ to, subject, text });
    if (transportName() === "http") return await sendViaHttp({ to, subject, text });
    return simulated(to, subject);
  } catch (err) {
    console.error("[delivery:email] send failed:", err.message);
    return { driver: transportName(), status: "FAILED", error: err.message, messageId: "" };
  }
}

module.exports = { send, isLive, describe, transportName };