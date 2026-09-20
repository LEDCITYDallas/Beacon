const config = require("../../config/env");

// ---------------------------------------------------------------------
// WhatsApp delivery adapter (Priority 5 / Section 11).
//
// Real Meta WhatsApp Cloud API over HTTPS - no SDK needed. It activates when
// Omair supplies WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID and sets
// NOTIFY_DRIVER=live. Until then every send is SIMULATED and clearly logged, so
// the Friday digest and handoff flows can be built and tested end to end
// without a live WhatsApp account (Section 10.2-10.4).
//
// This module only TRANSMITS. Message text is produced by
// services/notifications/composer.js, so the wording can change independently
// of the delivery channel.
//
// Return contract (never throws):
//   { driver, status: SENT | SIMULATED | FAILED | SKIPPED_NO_ADDRESS, error, messageId }
// ---------------------------------------------------------------------

function isConfigured() {
  const { token, phoneNumberId } = config.notifications.whatsapp;
  return Boolean(token && phoneNumberId);
}

function isLive() {
  return config.notifications.driver === "live" && isConfigured();
}

// Cloud API wants digits only, with the country code, no "+", no spaces.
function normaliseNumber(raw) {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  return digits.length >= 8 ? digits : "";
}

function describe() {
  return {
    channel: "WHATSAPP",
    driver: "whatsapp_cloud",
    live: isLive(),
    configured: isConfigured(),
    masterSwitch: config.notifications.driver,
    omairNumberSet: Boolean(config.notifications.digest.omairWhatsApp),
  };
}

async function send({ to, text }) {
  const number = normaliseNumber(to);
  if (!number) {
    return {
      driver: "none",
      status: "SKIPPED_NO_ADDRESS",
      error: "no usable WhatsApp number for this recipient",
      messageId: "",
    };
  }

  if (!isLive()) {
    console.log(`[delivery:whatsapp:mock] would send to ${number}: ${String(text).slice(0, 80)}...`);
    return { driver: "mock", status: "SIMULATED", error: "", messageId: "" };
  }

  const { apiVersion, phoneNumberId, token } = config.notifications.whatsapp;
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: number,
        type: "text",
        // Meta's hard limit on a text body.
        text: { preview_url: false, body: String(text).slice(0, 4096) },
      }),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        driver: "whatsapp_cloud",
        status: "FAILED",
        error:
          (body && body.error && body.error.message) || `HTTP ${res.status}`,
        messageId: "",
      };
    }
    return {
      driver: "whatsapp_cloud",
      status: "SENT",
      error: "",
      messageId: (body && body.messages && body.messages[0] && body.messages[0].id) || "",
    };
  } catch (err) {
    return {
      driver: "whatsapp_cloud",
      status: "FAILED",
      error: err.name === "AbortError" ? "WhatsApp API timed out" : err.message,
      messageId: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { send, isLive, isConfigured, describe, normaliseNumber };