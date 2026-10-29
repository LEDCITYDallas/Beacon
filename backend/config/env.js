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
  openai: "gpt-5-mini",
  gemini: "gemini-3.8-flash",
  anthropic: "claude-3-5-haiku-latest",
};

// List-price estimates for the Super Admin usage report, not an invoice.
// Gemini 3.8 Flash introductory rates (through 2026-12-31) and GPT-5 mini
// published rates. Verify on the provider pricing page before go-live.
const AI_DEFAULT_COST_PER_MILLION = {
  mock: { input: 0, output: 0 },
  openai: { input: 0.25, output: 2 },
  gemini: { input: 0.75, output: 3.75 },
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
    askRateLimitMax: intFromEnv("AI_ASK_RATE_LIMIT", 40),
    monthlyBudgetUsd: floatFromEnv("AI_MONTHLY_BUDGET_USD", 25),
    // Temporary outages only. A missing or rejected key never uses this path.
    // Production defaults to false so an outage is an error, not a mock answer.
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

// Production matches mongodb-setup: a named user and TLS. Local development
// keeps an open localhost URI, so this runs only when NODE_ENV=production.
// The returned text never includes the URI, because the URI contains the password.
function mongoUriProductionProblems(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return ["MONGO_URI is not a valid database URL. Production requires a username, a password, and tls=true."];
  }
  const protocol = parsed.protocol.replace(":", "");
  if (protocol !== "mongodb" && protocol !== "mongodb+srv") {
    return ["MONGO_URI must use mongodb:// or mongodb+srv://."];
  }
  const problems = [];
  if (!parsed.username) {
    problems.push("MONGO_URI has no username. Production requires the workforce_app user.");
  }
  if (!parsed.password) {
    problems.push("MONGO_URI has no password. Production requires the workforce_app password.");
  }
  const flag = (name) => {
    for (const [key, value] of parsed.searchParams.entries()) {
      if (key.toLowerCase() === name) return String(value).toLowerCase();
    }
    return "";
  };
  const tlsOn = protocol === "mongodb+srv" || ["true", "1", "yes"].includes(flag("tls") || flag("ssl"));
  if (!tlsOn) {
    problems.push("MONGO_URI does not enable TLS. Production requires tls=true.");
  }
  return problems;
}

// Read at call time so a production process cannot keep the development
// defaults just because the variables were left unset.
function productionProblems() {
  if ((process.env.NODE_ENV || "development") !== "production") return [];
  const problems = [];
  const mongoUri = String(process.env.MONGO_URI || "").trim();
  if (!mongoUri) problems.push("MONGO_URI is not set");
  else problems.push(...mongoUriProductionProblems(mongoUri));
  if (!String(process.env.FRONTEND_ORIGIN || "").trim()) {
    problems.push("FRONTEND_ORIGIN is not set");
  }
  const provider = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  const allowMock = String(process.env.ALLOW_MOCK_AI || "").toLowerCase() === "true";
  if (!provider || provider === "mock") {
    if (!allowMock) {
      problems.push(
        "AI_PROVIDER is unset or mock. Set gemini, openai, or anthropic, or set ALLOW_MOCK_AI=true for a labelled mock."
      );
    }
  } else if (!["gemini", "openai", "anthropic"].includes(provider)) {
    problems.push("AI_PROVIDER is not a supported provider");
  } else if (!String(process.env.AI_API_KEY || "").trim()) {
    problems.push("AI_API_KEY is not set");
  }
  return problems;
}

function productionWarnings() {
  if ((process.env.NODE_ENV || "development") !== "production") return [];
  const warnings = [];
  const origin = String(process.env.FRONTEND_ORIGIN || "");
  if (/localhost|127\.0\.0\.1/i.test(origin)) {
    warnings.push("FRONTEND_ORIGIN is a local address. Setup links will only work on that machine.");
  }
  if (boolFromEnv("AI_FALLBACK_TO_MOCK", false)) {
    warnings.push("AI_FALLBACK_TO_MOCK is on. A provider outage returns a labelled mock answer.");
  }
  if ((process.env.NOTIFY_DRIVER || "mock").toLowerCase() !== "live") {
    warnings.push("NOTIFY_DRIVER is not live. Account links are not emailed.");
  }
  if ((process.env.INTEGRATIONS_DRIVER || "mock").toLowerCase() !== "live") {
    warnings.push("INTEGRATIONS_DRIVER is not live. No vendor system is contacted.");
  }
  return warnings;
}

config.productionProblems = productionProblems;
config.productionWarnings = productionWarnings;

module.exports = config;