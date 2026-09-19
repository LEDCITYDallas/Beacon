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

const app = express();

// --- Security hardening -------------------------------------------------

app.use(helmet());

const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

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
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", generalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Too many login attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", loginLimiter);

// --------------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "led-city-workforce-backend", phase: "1+2" });
});

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/assistant", assistantRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
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
