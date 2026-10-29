require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const hpp = require("hpp");
const mongoSanitize = require("express-mongo-sanitize");
const rateLimit = require("express-rate-limit");

// Fail fast and clearly at startup instead of crashing later on the
// first login attempt with a confusing jsonwebtoken error.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === "") {
  console.error(
    "\n[startup] JWT_SECRET is missing or empty in your .env file.\n" +
      "Generate one and set it, e.g. in PowerShell:\n" +
      "  [Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }))\n" +
      "Then set JWT_SECRET=<that value> in backend/.env and restart.\n"
  );
  process.exit(1);
}

const authRoutes = require("./routes/authRoutes");
const taskRoutes = require("./routes/taskRoutes");
const assistantRoutes = require("./routes/assistantRoutes");
const activityRoutes = require("./routes/activityRoutes");
const statsRoutes = require("./routes/statsRoutes");
const alertRoutes = require("./routes/alertRoutes");
const scorecardRoutes = require("./routes/scorecardRoutes");
const digestRoutes = require("./routes/digestRoutes");
const liveViewRoutes = require("./routes/liveViewRoutes");
const adminRoutes = require("./routes/adminRoutes");
const userRoutes = require("./routes/userRoutes");
const integrationRoutes = require("./routes/integrationRoutes");
const config = require("./config/env");
const { redactSecrets } = require("./utils/redact");

const productionProblems = config.productionProblems();
if (productionProblems.length) {
  console.error("[startup] Refusing to start in production:\n- " + productionProblems.join("\n- "));
  process.exit(1);
}
for (const warning of config.productionWarnings()) {
  console.error("[startup] " + warning);
}

const app = express();

// --- Security hardening -------------------------------------------------

app.use(helmet());

const allowedOrigins = config.frontendOrigins;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "200kb" }));
app.use(mongoSanitize());
app.use(hpp());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.security.generalRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", generalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.security.loginRateLimitMax,
  message: { message: "Too many login attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", loginLimiter);

// The live-view frame upload is short-interval by nature, so it gets its own
// generous-but-bounded bucket instead of the general one throttling it.
const frameLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  message: { message: "Too many live-view frames." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/liveview/sessions/", frameLimiter);

// --------------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "led-city-workforce-backend",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/assistant", assistantRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/scorecard", scorecardRoutes);
app.use("/api/digest", digestRoutes);
app.use("/api/liveview", liveViewRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);
app.use("/api/integrations", integrationRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("[error]", redactSecrets(err && (err.stack || err.message || err)));
  const isProd = process.env.NODE_ENV === "production";

  // Mongoose cast/validation errors are client mistakes -> 400, not 500.
  if (err.name === "CastError" || err.name === "ValidationError") {
    return res.status(400).json({ message: isProd ? "Invalid request" : err.message });
  }

  res.status(err.status || 500).json({
    message: isProd ? "Server error" : err.message,
  });
});

module.exports = app;
