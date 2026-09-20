// ---------------------------------------------------------------------
// Centralised environment configuration.
//
// Rules this file exists to enforce (Sections 9-10 of the requirements):
//   - No secret is ever hard-coded here. Everything sensitive is read from
//     process.env, which Omair populates on the Mac mini (never committed).
//   - Development defaults to mock drivers, so the whole system runs with
//     mock data and zero live credentials (Section 10.2).
//   - Switching a driver to "live" is a config change, never a code change.
// ---------------------------------------------------------------------
require("dotenv").config();

function boolFromEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function intFromEnv(name, fallback) {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) ? v : fallback;
}

function floatFromEnv(name, fallback) {
  const v = parseFloat(process.env[name] || "");
  return Number.isFinite(v) ? v : fallback;
}

function listFromEnv(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

// Published list prices ($ per 1M tokens). Used only to ESTIMATE spend for
// the Super Admin usage report - the real bill comes from the provider.
// Verify against the provider's pricing page at purchase time.
const AI_DEFAULT_MODELS = {
  mock: "mock-v1",
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
  anthropic: "claude-3-5-haiku-latest",
};

const AI_DEFAULT_COST_PER_MILLION = {
  mock: { input: 0, output: 0 },
  openai: { input: 0.15, output: 0.6 },
  gemini: { input: 0.075, output: 0.3 },
  anthropic: { input: 0.8, output: 4.0 },
};

const aiProvider = (process.env.AI_PROVIDER || "mock").toLowerCase();

// Section 6 hard requirement: the idle window is 15-20 minutes. It is
// configurable INSIDE that window, never outside it.
const idleThresholdMinutes = Math.min(
  20,
  Math.max(15, intFromEnv("IDLE_THRESHOLD_MINUTES", 15))
);

const config = {
  nodeEnv,
  isProduction,
  port: intFromEnv("PORT", 5000),
  mongoUri: process.env.MONGO_URI || "",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  frontendOrigins: listFromEnv("FRONTEND_ORIGIN", ["http://localhost:5173"]),

  // Section 10.2: while true the system never reaches a live vendor API.
  mockMode: boolFromEnv("MOCK_MODE", !isProduction),

  ai: {
    provider: aiProvider,
    model: process.env.AI_MODEL || AI_DEFAULT_MODELS[aiProvider] || "mock-v1",
    apiKey: process.env.AI_API_KEY || "",
    baseUrl: process.env.AI_BASE_URL || "",
    timeoutMs: intFromEnv("AI_TIMEOUT_MS", 30000),
    maxRetries: intFromEnv("AI_MAX_RETRIES", 1),
    maxOutputTokens: intFromEnv("AI_MAX_OUTPUT_TOKENS", 900),
    temperature: floatFromEnv("AI_TEMPERATURE", 0.3),
    dailyCallLimitPerUser: intFromEnv("AI_DAILY_CALL_LIMIT", 200),
    monthlyBudgetUsd: floatFromEnv("AI_MONTHLY_BUDGET_USD", 25),
    // In development a missing key degrades to the mock provider so the app
    // stays usable. In production a failure surfaces as an error instead of
    // silently pretending to be a real assistant.
    fallbackToMock: boolFromEnv("AI_FALLBACK_TO_MOCK", !isProduction),
    costPerMillion:
      AI_DEFAULT_COST_PER_MILLION[aiProvider] || AI_DEFAULT_COST_PER_MILLION.mock,
  },

  activity: {
    idleThresholdMinutes,
    heartbeatSeconds: intFromEnv("HEARTBEAT_SECONDS", 60),
    staleAfterMinutes: intFromEnv("ACTIVITY_STALE_MINUTES", idleThresholdMinutes),
    // Only activity/idle state + timestamps are ever recorded. There is no
    // keystroke, key-content, screenshot, webcam, audio or window-title
    // collection anywhere in this system.
    collectContent: false,
  },

  liveView: {
    // Final role scope is a client decision (Section 12). It is stored in
    // PermissionSettings and is configurable at runtime without code changes;
    // this env value is only the bootstrap default.
    allowedRoles: listFromEnv("LIVEVIEW_ALLOWED_ROLES", ["SUPER_ADMIN"]),
    excludeReducedMonitoring: boolFromEnv("LIVEVIEW_EXCLUDE_REDUCED", true),
    requireEmployeeApproval: boolFromEnv("LIVEVIEW_REQUIRE_APPROVAL", true),
    frameTtlSeconds: intFromEnv("LIVEVIEW_FRAME_TTL_SECONDS", 5),
    maxFrameBytes: intFromEnv("LIVEVIEW_MAX_FRAME_BYTES", 400000),
    minFrameIntervalMs: intFromEnv("LIVEVIEW_MIN_FRAME_INTERVAL_MS", 500),
    requestTtlSeconds: intFromEnv("LIVEVIEW_REQUEST_TTL_SECONDS", 90),
    idleTimeoutSeconds: intFromEnv("LIVEVIEW_IDLE_TIMEOUT_SECONDS", 120),
  },

  notifications: {
    // "mock" records what WOULD be sent; "live" performs the real send.
    driver: (process.env.NOTIFY_DRIVER || "mock").toLowerCase(),
    autoOverrunEmail: boolFromEnv("NOTIFY_ON_OVERRUN", false),
    digest: {
      timezone: process.env.DIGEST_TIMEZONE || "America/Chicago",
      dayOfWeek: intFromEnv("DIGEST_DAY_OF_WEEK", 5), // 0 Sun .. 5 Fri
      hour: intFromEnv("DIGEST_HOUR", 17),
      minute: intFromEnv("DIGEST_MINUTE", 0),
      omairWhatsApp: process.env.OMAIR_WHATSAPP_NUMBER || "",
      enabled: boolFromEnv("DIGEST_SEND_ENABLED", false),
    },
    whatsapp: {
      apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      token: process.env.WHATSAPP_TOKEN || "",
    },
    email: {
      transport: (process.env.EMAIL_TRANSPORT || "mock").toLowerCase(), // mock | smtp | http
      from: process.env.EMAIL_FROM || "workforce@localhost",
      smtp: {
        host: process.env.SMTP_HOST || "",
        port: intFromEnv("SMTP_PORT", 587),
        secure: boolFromEnv("SMTP_SECURE", false),
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "",
      },
      http: {
        url: process.env.EMAIL_HTTP_URL || "",
        token: process.env.EMAIL_HTTP_TOKEN || "",
      },
    },
  },

  integrations: {
    // mock | live   (live requires Omair's OAuth tokens, Section 10.3-10.4)
    driver: (process.env.INTEGRATIONS_DRIVER || "mock").toLowerCase(),
    zoho: {
      crmBase: process.env.ZOHO_CRM_API_BASE || "https://www.zohoapis.com/crm/v5",
      booksBase: process.env.ZOHO_BOOKS_API_BASE || "https://www.zohoapis.com/books/v3",
      inventoryBase:
        process.env.ZOHO_INVENTORY_API_BASE || "https://www.zohoapis.com/inventory/v1",
      orgId: process.env.ZOHO_ORG_ID || "",
      accessToken: process.env.ZOHO_ACCESS_TOKEN || "",
    },
    workdrive: {
      base: process.env.WORKDRIVE_API_BASE || "https://www.zohoapis.com/workdrive/api/v1",
      accessToken: process.env.WORKDRIVE_ACCESS_TOKEN || "",
    },
    cms: {
      base: process.env.CMS_API_BASE || "",
      token: process.env.CMS_API_TOKEN || "",
    },
  },

  retention: {
    // Section 12: the period is an open client decision. Until Omair supplies
    // it, `enabled` stays false and the cleanup job deletes nothing.
    enabled: boolFromEnv("RETENTION_ENABLED", false),
    days: {
      activityLogs: process.env.RETENTION_ACTIVITY_DAYS
        ? intFromEnv("RETENTION_ACTIVITY_DAYS", 0)
        : null,
      liveViewSessions: process.env.RETENTION_LIVEVIEW_DAYS
        ? intFromEnv("RETENTION_LIVEVIEW_DAYS", 0)
        : null,
      notificationLogs: process.env.RETENTION_NOTIFICATION_DAYS
        ? intFromEnv("RETENTION_NOTIFICATION_DAYS", 0)
        : null,
      aiUsageLogs: process.env.RETENTION_AI_USAGE_DAYS
        ? intFromEnv("RETENTION_AI_USAGE_DAYS", 0)
        : null,
      decidedProposals: process.env.RETENTION_PROPOSAL_DAYS
        ? intFromEnv("RETENTION_PROPOSAL_DAYS", 0)
        : null,
      integrationSignals: process.env.RETENTION_INTEGRATION_DAYS
        ? intFromEnv("RETENTION_INTEGRATION_DAYS", 0)
        : null,
    },
  },

  security: {
    // Dev-friendly default: the smoke test makes a few hundred requests from one
    // IP. Omair tunes this down on the Mac mini if the pilot grows (and the
    // login limiter below is the one that actually matters for security).
    generalRateLimitMax: intFromEnv("RATE_LIMIT_MAX", 1000),
    loginRateLimitMax: intFromEnv("LOGIN_RATE_LIMIT_MAX", 10),
  },
};

module.exports = config;