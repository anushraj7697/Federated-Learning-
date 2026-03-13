/**
 * AI-Based Account Hijack Prevention System
 * Node.js + Express backend
 */

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const db = require("./models/db");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "login-risk-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Protected/conditional routes before static so session is checked first
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect("/login.html");
}
app.get("/dashboard.html", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/adaptive_question.html", (req, res) => {
  if (!req.session.pendingLogin) return res.redirect("/login.html");
  res.sendFile(path.join(__dirname, "public", "adaptive_question.html"));
});
app.get("/blocked.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "blocked.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// Dev: create test user - must be before /api auth router
app.post("/api/test-create-user", async (req, res) => {
  try {
    const user = require("./models/user");
    const u = user.findByUsername("simtest");
    if (u) {
      return res.json({ username: "simtest", password: "SimTest123!", message: "User exists" });
    }
    try {
      user.createUser("simtest", "simtest@test.com", "SimTest123!", "127.0.0.1", "Test");
    } catch (createErr) {
      // User may already exist from partial create; return credentials anyway
      if (user.findByUsername("simtest")) {
        return res.json({ username: "simtest", password: "SimTest123!", message: "User exists" });
      }
      throw createErr;
    }
    res.json({ username: "simtest", password: "SimTest123!", message: "Created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dev: reset simtest failed attempts and lock so E2E tests start from clean state
app.post("/api/test-reset-simtest", (req, res) => {
  try {
    const user = require("./models/user");
    const u = user.findByUsername("simtest");
    if (u) {
      user.resetFailedAttempts(u.id);
      user.setLockedUntil(u.id, null);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/api", authRoutes);
app.use("/api/admin", adminRoutes);

// Reset failed attempts for current user (clears failed_attempts_24h for next login)
app.post("/api/reset-failed-attempts", (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    require("./models/user").resetFailedAttempts(req.session.userId);
    res.json({ success: true, message: "Failed attempts reset. Next login will show lower risk." });
  } catch (err) {
    console.error("Reset failed attempts error:", err);
    res.status(500).json({ error: "Failed to reset. Please try again." });
  }
});

// Debug: view raw login history (remove in production)
app.get("/api/debug/history", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const history = require("./models/user").getLoginHistory(req.session.userId, 50);
  res.json(history);
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const user = require("./models/user").findById(req.session.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const profile = require("./models/user").getProfile(req.session.userId);
  const history = require("./models/user").getLoginHistory(req.session.userId, 20);
  const historyWithFactors = history.map((h) => ({
    ...h,
    risk_factors: typeof h.risk_factors === "string" ? (() => { try { return JSON.parse(h.risk_factors); } catch (_) { return []; } })() : (h.risk_factors || []),
  }));
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    profile,
    history: historyWithFactors,
  });
});

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
