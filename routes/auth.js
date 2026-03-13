/**
 * Authentication routes - Register, Login, Calibrated Risk, Decision Engine
 */

const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const userModel = require("../models/user");
const { getGeoFromIp } = require("../services/geolocation");

const ML_API_URL = "http://localhost:8000/predict";

const LOCK_AFTER_CONSECUTIVE_FAILS = 5;
const LOCK_DURATION_MINUTES = 10;
const RISK_THRESHOLD_LOW = 0.4;   // Low R < 0.4; Medium 0.4 ≤ R < 0.75; High R ≥ 0.75
const RISK_THRESHOLD_HIGH = 0.75;
const BASE_RISK_MIN = 0.05;
const BASE_RISK_MAX = 0.15;
const DECAY_MINUTES_SINCE_SUCCESS = 5;

function normalizeIp(ip) {
  if (!ip) return "unknown";
  const s = String(ip).trim().toLowerCase();
  if (s === "::1" || s === "127.0.0.1" || s === "::ffff:127.0.0.1") return "localhost";
  return s;
}

function buildFeatures(userId, ip, device, profile, currentCity, currentCountry) {
  const ipNorm = normalizeIp(ip);
  const usualIpNorm = profile?.usual_ip ? normalizeIp(profile.usual_ip) : null;
  const ipNew = usualIpNorm && ipNorm !== usualIpNorm ? 1 : 0;
  const deviceNew = profile?.usual_device && device !== profile.usual_device ? 1 : 0;
  const countryNew = (profile?.usual_country && currentCountry && profile.usual_country !== currentCountry) ? 1 : 0;

  const now = new Date();
  const currentHour = now.getHours();
  let timeDeviation = 0;
  if (profile && profile.usual_login_hour_start != null && profile.usual_login_hour_end != null) {
    const inRange = currentHour >= profile.usual_login_hour_start && currentHour <= profile.usual_login_hour_end;
    if (!inRange) {
      const mid = (profile.usual_login_hour_start + profile.usual_login_hour_end) / 2;
      timeDeviation = Math.min(1, Math.abs(currentHour - mid) / 12);
    }
  }

  const failed24h = userModel.getFailedAttempts24h(userId);
  const failed5min = userModel.getFailedAttemptsInLast5Min(userId);
  const failed30sec = userModel.getFailedAttemptsInLast30Sec(userId);
  const consecutiveFailed = userModel.getConsecutiveFailedCount(userId);
  const lastSuccessTime = userModel.getLastSuccessfulLoginTime(userId);

  const passwordAttempts = Math.min(1 + failed24h, 10);
  const rapidAttemptFlag = failed30sec >= 3 ? 1 : 0;
  const loginFrequency5min = Math.min(failed5min + (failed5min > 0 ? 1 : 0), 5);

  let sessionAgeMinutes = null;
  if (lastSuccessTime) {
    sessionAgeMinutes = (now - new Date(lastSuccessTime)) / (60 * 1000);
  }

  return {
    ipNew,
    locationNew: ipNew,
    deviceNew,
    countryNew,
    timeDeviation,
    passwordAttempts,
    failedAttempts24h: failed24h,
    geoDistance: ipNew ? 700 : 25,
    failed5min,
    failed30sec,
    rapidAttemptFlag,
    loginFrequency5min,
    consecutiveFailed,
    sessionAgeMinutes,
    lastSuccessTime,
  };
}

function applyDecay(failedComponent, userId) {
  const lastSuccess = userModel.getLastSuccessfulLoginTime(userId);
  if (!lastSuccess) return failedComponent;
  const minutesSince = (Date.now() - new Date(lastSuccess)) / (60 * 1000);
  const noFailuresIn5Min = userModel.getFailedAttemptsInLast5Min(userId) === 0;
  if (minutesSince >= DECAY_MINUTES_SINCE_SUCCESS && noFailuresIn5Min) {
    return failedComponent * 0.4;
  }
  return failedComponent;
}

async function computeCalibratedRisk(userId, features) {
  const factors = [];
  let baseRisk = BASE_RISK_MIN + (BASE_RISK_MAX - BASE_RISK_MIN) * Math.random();
  baseRisk = Math.round(baseRisk * 100) / 100;
  factors.push({ label: "Base risk", percent: Math.round(baseRisk * 100), reason: "Normal login baseline" });

  let failedComponent = 0;
  if (features.failedAttempts24h > 0) {
    failedComponent = Math.min(0.35, 0.05 * Math.min(features.failedAttempts24h, 3) + 0.03 * Math.max(0, features.failedAttempts24h - 3));
    failedComponent = applyDecay(failedComponent, userId);
    const pct = Math.round(failedComponent * 100);
    if (pct > 0) factors.push({ label: "Failed login attempts (24h)", percent: pct, reason: `${features.failedAttempts24h} wrong password(s) recently` });
  }

  let timeComponent = features.timeDeviation * 0.2;
  if (timeComponent > 0.01) {
    factors.push({ label: "Unusual login time", percent: Math.round(timeComponent * 100), reason: "Outside your usual login hours" });
  }

  let ipComponent = features.ipNew ? 0.15 : 0;
  if (ipComponent > 0) factors.push({ label: "New location / IP", percent: 15, reason: "Login from an unfamiliar IP" });

  let deviceComponent = features.deviceNew ? 0.10 : 0;
  if (deviceComponent > 0) factors.push({ label: "New device", percent: 10, reason: "Different device than usual" });

  let countryComponent = features.countryNew ? 0.15 : 0;
  if (countryComponent > 0) factors.push({ label: "New country", percent: 15, reason: "Login from a different country" });

  let rapidComponent = features.rapidAttemptFlag ? 0.15 : 0;
  if (rapidComponent > 0) factors.push({ label: "Rapid login attempts", percent: 15, reason: "Several attempts in 30 seconds" });

  let freqComponent = features.loginFrequency5min >= 2 ? 0.10 : 0;
  if (freqComponent > 0) factors.push({ label: "High login frequency", percent: 10, reason: "Multiple attempts in last 5 minutes" });

  let total = baseRisk + failedComponent + timeComponent + ipComponent + deviceComponent + countryComponent + rapidComponent + freqComponent;
  total = Math.min(1, Math.round(total * 100) / 100);

  let mlScore = 0.5;
  try {
    const featArr = [
      features.ipNew,
      features.locationNew,
      features.deviceNew,
      features.timeDeviation,
      features.passwordAttempts,
      features.failedAttempts24h,
      features.geoDistance,
    ];
    const res = await fetch(ML_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: featArr }),
    });
    if (res.ok) {
      const data = await res.json();
      mlScore = data.risk_score;
    }
  } catch (_) {}

  const blended = total * 0.75 + mlScore * 0.25;
  const riskScore = Math.min(1, Math.round(blended * 100) / 100);

  return { riskScore, factors };
}

async function getRiskWithFactors(userId, ip, device, profile, city, country) {
  const features = buildFeatures(userId, ip, device, profile, city, country);
  return await computeCalibratedRisk(userId, features);
}

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const device = req.get("User-Agent") || "unknown";

  if (!username || !email || !password) {
    return res.status(400).json({ error: "Username, email and password required" });
  }

  if (userModel.findByUsername(username)) {
    return res.status(400).json({ error: "Username already exists" });
  }
  if (userModel.findByEmail(email)) {
    return res.status(400).json({ error: "Email already exists" });
  }

  try {
    const { city, country } = await getGeoFromIp(ip);
    const userId = userModel.createUser(username, email, password, ip, device, city, country);
    req.session.userId = userId;
    req.session.username = username;
    return res.json({ success: true, userId });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Registration failed", detail: err.message });
  }
});

router.post("/login", async (req, res) => {
  const { username, password, testIp, testDevice } = req.body;
  const ip = (testIp && String(testIp).trim()) || req.ip || req.connection?.remoteAddress || "unknown";
  const device = (testDevice && String(testDevice).trim()) || req.get("User-Agent") || "unknown";

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const user = userModel.findByUsername(username);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.blocked) {
    return res.status(403).json({ error: "Account is blocked" });
  }

  const lockedUntil = userModel.getLockedUntil(user.id);
  if (lockedUntil) {
    const until = new Date(lockedUntil);
    if (until > new Date()) {
      const mins = Math.ceil((until - new Date()) / 60000);
      return res.status(423).json({
        error: "Account temporarily locked",
        message: `Too many failed attempts. Try again in ${mins} minute(s).`,
        lockedUntil: lockedUntil,
      });
    }
    userModel.setLockedUntil(user.id, null);
  }

  const { city, country } = await getGeoFromIp(ip);
  const loginTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });

  const validPassword = userModel.verifyPassword(user, password);
  if (!validPassword) {
    userModel.recordFailedAttempt(user.id, ip);
    try {
      userModel.addLoginHistory(user.id, ip, device, 1, null, "failed", null, city, country);
    } catch (err) {
      console.error("[Auth] Failed to record failed login:", err);
    }
    const failed24h = userModel.getFailedAttempts24h(user.id);
    if (failed24h > 3) {
      const emailService = require("../services/emailService");
      emailService.sendSecurityAlert(user.email, ip, city, country, device, loginTime, null).catch((e) => console.error("[Email]", e.message));
    }
    const consecutive = userModel.getConsecutiveFailedCount(user.id);
    if (consecutive >= LOCK_AFTER_CONSECUTIVE_FAILS) {
      const until = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString();
      userModel.setLockedUntil(user.id, until);
      return res.status(423).json({
        error: "Account temporarily locked",
        message: `Too many failed attempts. Account locked for ${LOCK_DURATION_MINUTES} minutes.`,
        lockedUntil: until,
      });
    }
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const profile = userModel.getProfile(user.id);
  const { riskScore, factors } = await getRiskWithFactors(user.id, ip, device, profile, city, country);
  const riskFactorsJson = JSON.stringify(factors);

  const features = buildFeatures(user.id, ip, device, profile, city, country);
  const isNewCountry = !!features.countryNew;
  const isNewDeviceAndLocation = !!features.deviceNew && !!features.ipNew;

  if (riskScore < RISK_THRESHOLD_LOW) {
    userModel.addLoginHistory(user.id, ip, device, 1, riskScore, "success", riskFactorsJson, city, country);
    userModel.updateProfile(user.id, ip, device, new Date().getHours());
    userModel.resetFailedAttempts(user.id);
    req.session.userId = user.id;
    req.session.username = user.username;
    return res.json({ action: "dashboard", riskScore, riskFactors: factors });
  }

  if (riskScore >= RISK_THRESHOLD_HIGH) {
    userModel.addLoginHistory(user.id, ip, device, 1, riskScore, "blocked", riskFactorsJson, city, country);
    const emailService = require("../services/emailService");
    emailService.sendSecurityAlert(user.email, ip, city, country, device, loginTime, riskScore).catch((e) => console.error("[Email]", e.message));
    return res.json({ action: "blocked", riskScore, riskFactors: factors });
  }

  if (isNewCountry || isNewDeviceAndLocation) {
    const emailService = require("../services/emailService");
    emailService.sendSecurityAlert(user.email, ip, city, country, device, loginTime, riskScore).catch((e) => console.error("[Email]", e.message));
  }

  req.session.pendingLogin = {
    userId: user.id,
    username: user.username,
    ip,
    device,
    city,
    country,
    riskScore,
    riskFactors: factors,
    profile,
  };
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: "Session save failed" });
    return res.json({ action: "adaptive", riskScore, riskFactors: factors });
  });
});

router.post("/adaptive-answer", (req, res) => {
  const { answer } = req.body;
  const pending = req.session.pendingLogin;

  if (!pending) {
    return res.status(400).json({ error: "No pending login" });
  }

  const riskFactorsJson = JSON.stringify(pending.riskFactors || []);

  if (answer === "yes") {
    userModel.addLoginHistory(pending.userId, pending.ip, pending.device, 1, pending.riskScore, "success", riskFactorsJson, pending.city, pending.country);
    userModel.updateProfile(pending.userId, pending.ip, pending.device, new Date().getHours());
    userModel.resetFailedAttempts(pending.userId);
    req.session.userId = pending.userId;
    req.session.username = pending.username;
    delete req.session.pendingLogin;
    return res.json({ success: true, action: "dashboard" });
  }

  userModel.addLoginHistory(pending.userId, pending.ip, pending.device, 1, pending.riskScore, "blocked", riskFactorsJson, pending.city, pending.country);
  delete req.session.pendingLogin;
  return res.json({ success: false, action: "blocked" });
});

router.get("/adaptive-question", (req, res) => {
  const pending = req.session.pendingLogin;
  if (!pending) return res.status(400).json({ error: "No pending login" });

  const { profile } = pending;
  const history = userModel.getLoginHistory(pending.userId, 5);
  const lastSuccess = history.find(h => h.status === "success");

  let question = "Is this you attempting to login?";

  if (profile?.usual_ip && lastSuccess?.ip) {
    question = `Your last login was from ${lastSuccess.ip}. Is this you logging in again from a different location?`;
  } else if (profile?.usual_login_hour_start != null && profile?.usual_login_hour_end != null) {
    question = `You usually login between ${profile.usual_login_hour_start}:00 and ${profile.usual_login_hour_end}:00. Is this you?`;
  } else if (profile?.usual_device) {
    question = `Is this your regular device (${profile.usual_device})?`;
  } else if (lastSuccess?.ip) {
    question = `Last time you logged in from ${lastSuccess.ip}. Is this you?`;
  }

  return res.json({ question, riskScore: pending.riskScore });
});

router.post("/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

module.exports = router;
