/**
 * Admin routes - Dashboard stats, user management
 */

const express = require("express");
const router = express.Router();
const userModel = require("../models/user");

// Hardcoded admin credentials
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

function isAdmin(req) {
  return req.session?.admin === true;
}

// POST /api/admin/login
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: "Invalid admin credentials" });
});

// POST /api/admin/logout
router.post("/logout", (req, res) => {
  req.session.admin = false;
  res.json({ success: true });
});

// All routes below require admin
router.use((req, res, next) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
});

// GET /api/admin/stats
router.get("/stats", (req, res) => {
  const stats = userModel.getAdminStats();
  res.json(stats);
});

// GET /api/admin/users
router.get("/users", (req, res) => {
  const users = userModel.getAllUsers();
  res.json(users);
});

// GET /api/admin/logins
router.get("/logins", (req, res) => {
  const logins = userModel.getAllLoginHistory();
  res.json(logins);
});

// GET /api/admin/risk-distribution (Low < 0.4, Medium 0.4–0.75, High ≥ 0.75)
router.get("/risk-distribution", (req, res) => {
  const db = require("../models/db").getDb();
  const low = db.prepare("SELECT COUNT(*) as c FROM LoginHistory WHERE risk_score < 0.4 OR risk_score IS NULL").get().c;
  const medium = db.prepare("SELECT COUNT(*) as c FROM LoginHistory WHERE risk_score >= 0.4 AND risk_score < 0.75").get().c;
  const high = db.prepare("SELECT COUNT(*) as c FROM LoginHistory WHERE risk_score >= 0.75").get().c;
  res.json({ low, medium, high });
});

// POST /api/admin/block/:userId
router.post("/block/:userId", (req, res) => {
  userModel.setBlocked(req.params.userId, true);
  res.json({ success: true });
});

// POST /api/admin/unblock/:userId
router.post("/unblock/:userId", (req, res) => {
  userModel.setBlocked(req.params.userId, false);
  res.json({ success: true });
});

// POST /api/admin/reset-attempts/:userId
router.post("/reset-attempts/:userId", (req, res) => {
  userModel.resetFailedAttempts(req.params.userId);
  res.json({ success: true });
});

// GET /api/admin/user-history/:userId
router.get("/user-history/:userId", (req, res) => {
  const history = userModel.getLoginHistory(req.params.userId, 100);
  res.json(history);
});

// POST /api/admin/reset-risk/:userId — reset user risk score, audit log
router.post("/reset-risk/:userId", (req, res) => {
  const userId = req.params.userId;
  userModel.resetUserRiskScore(userId);
  userModel.logAudit("reset_risk_score", userId, "Admin reset risk score to 0");
  res.json({ success: true });
});

// GET /api/admin/login-location-history — backfill missing city/country from IP (up to 80 per request)
router.get("/login-location-history", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1000);
  const { getGeoFromIp, isLocalIp } = require("../services/geolocation");
  let list = userModel.getLoginLocationHistory(limit);
  let filled = 0;
  const maxFill = 80;
  for (const row of list) {
    if (filled >= maxFill) break;
    if (!row.ip || isLocalIp(row.ip)) continue;
    const hasLocation = row.city || row.country;
    if (hasLocation) continue;
    try {
      const { city, country } = await getGeoFromIp(row.ip);
      if (city || country) {
        userModel.updateLoginLocation(row.id, city, country);
        row.city = city;
        row.country = country;
        filled++;
      }
    } catch (_) {}
  }
  res.json(list);
});

// GET /api/admin/password-attempt-patterns
router.get("/password-attempt-patterns", (req, res) => {
  res.json(userModel.getPasswordAttemptPatterns());
});

// GET /api/admin/high-risk-alerts ?from= &to= (ISO date)
router.get("/high-risk-alerts", (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  res.json(userModel.getHighRiskAlerts(from, to));
});

// GET /api/admin/time-based-login
router.get("/time-based-login", (req, res) => {
  res.json(userModel.getTimeBasedLoginPatterns());
});

// Format any date as IST (Asia/Kolkata)
// Parse DB datetime as UTC (no Z = SQLite stores UTC), then format as IST 24h
function toIST(d) {
  if (!d) return "";
  let s = d;
  if (typeof d === "string" && !/Z|[+-]\d{2}:?\d{2}$/.test(d))
    s = d.trim().replace(" ", "T") + "Z";
  return new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

// GET /api/admin/security-report ?format=csv|pdf
router.get("/security-report", (req, res) => {
  const format = (req.query.format || "csv").toLowerCase();
  const logins = userModel.getAllLoginHistory(2000);
  const locationHistory = userModel.getLoginLocationHistory(1000);
  const passwordPatterns = userModel.getPasswordAttemptPatterns();
  const highRisk = userModel.getHighRiskAlerts();
  const timeBased = userModel.getTimeBasedLoginPatterns();
  const users = userModel.getAllUsers();
  const blockedUsers = users.filter((u) => u.blocked);

  if (format === "pdf") {
    let PDFDocument;
    try {
      PDFDocument = require("pdfkit");
    } catch (_) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=security-report.csv");
      const csvRows = ["Section,Key,Value", "Summary,Total Logins," + logins.length, "Summary,High Risk Alerts," + highRisk.length, "Summary,Blocked Users," + blockedUsers.length];
      return res.send(csvRows.join("\n"));
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=security-report.pdf");
    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);
    doc.fontSize(16).text("FL-AHPS Security Report", { align: "center" }).moveDown();
    doc.fontSize(10)
      .text(`Generated: ${toIST(new Date())} (IST)`, { align: "center" })
      .moveDown(2)
      .text("Login attempts: " + logins.length)
      .text("High risk alerts: " + highRisk.length)
      .text("Blocked users: " + blockedUsers.length)
      .text("Password attempts = 1: " + passwordPatterns.attempts1 + ", = 2: " + passwordPatterns.attempts2 + ", >= 3: " + passwordPatterns.attempts3Plus)
      .moveDown();
    doc.text("High Risk Alerts (sample):").moveDown(0.5);
    highRisk.slice(0, 20).forEach((h) => {
      doc.text(`${h.username || h.user_id} | ${h.ip} | ${h.city}, ${h.country} | ${h.risk_score} | ${toIST(h.login_time)}`).moveDown(0.2);
    });
    doc.end();
    return;
  }

  // CSV — all times in IST
  const rows = [];
  rows.push("Section,Key,Value");
  rows.push("Summary,Total Logins," + logins.length);
  rows.push("Summary,High Risk Alerts," + highRisk.length);
  rows.push("Summary,Blocked Users," + blockedUsers.length);
  rows.push("Password Patterns,Attempts=1," + passwordPatterns.attempts1);
  rows.push("Password Patterns,Attempts=2," + passwordPatterns.attempts2);
  rows.push("Password Patterns,Attempts>=3," + passwordPatterns.attempts3Plus);
  rows.push("");
  rows.push("Login Location History,user,ip,city,country,login_time_IST,status");
  locationHistory.forEach((l) => {
    rows.push(`Location,${l.username || ""},${l.ip || ""},${l.city || ""},${l.country || ""},${toIST(l.login_time)},${l.status}`);
  });
  rows.push("");
  rows.push("High Risk Alerts,user,ip,city,country,time_IST,risk_score");
  highRisk.forEach((h) => {
    rows.push(`HighRisk,${h.username || ""},${h.ip || ""},${h.city || ""},${h.country || ""},${toIST(h.login_time)},${h.risk_score}`);
  });
  rows.push("");
  rows.push("Time Based,hour,count");
  timeBased.forEach((t) => {
    rows.push(`Hour,${t.hourLabel},${t.count}`);
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=security-report.csv");
  res.send(rows.join("\n"));
});

module.exports = router;
