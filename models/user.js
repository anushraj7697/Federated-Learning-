/**
 * User model - CRUD operations for Users, UserProfile, LoginHistory
 */

const dbModule = require("./db");
const bcrypt = require("bcrypt");

const SALT_ROUNDS = 10;

function db() {
  return dbModule.getDb();
}

// Store UTC in DB so display layer can convert to IST (format YYYY-MM-DD HH:MM:SS)
function getUTCNow() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

// Create user (city, country optional - from geolocation)
function createUser(username, email, password, ip, device, city = null, country = null) {
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const result = db().prepare(
    "INSERT INTO Users (username, email, password_hash, location_city, location_country, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(username, email, passwordHash, city || null, country || null, getUTCNow());
  
  let userId = result.lastInsertRowid;
  if (!userId || userId === 0) {
    // Fallback: query the user by email to get the ID
    const user = db().prepare("SELECT id FROM Users WHERE email = ?").get(email);
    if (user && user.id) {
      userId = user.id;
    } else {
      throw new Error("Failed to create user (insert failed or no id returned)");
    }
  }

  // INSERT OR IGNORE avoids UNIQUE constraint if profile row already exists (e.g. from a partial previous registration)
  db().prepare(
    "INSERT OR IGNORE INTO UserProfile (user_id, successful_logins) VALUES (?, 0)"
  ).run(userId);

  addLoginHistory(userId, ip, device, 1, null, "registration", null, city, country);

  return userId;
}

function findByUsername(username) {
  return db().prepare("SELECT * FROM Users WHERE username = ?").get(username);
}

function findByEmail(email) {
  return db().prepare("SELECT * FROM Users WHERE email = ?").get(email);
}

function findById(id) {
  return db().prepare("SELECT * FROM Users WHERE id = ?").get(id);
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

function addLoginHistory(userId, ip, device, attempts, riskScore, status, riskFactorsJson = null, locationCity = null, locationCountry = null) {
  return db().prepare(`
    INSERT INTO LoginHistory (user_id, ip, device, attempts, risk_score, status, risk_factors, location_city, location_country, login_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, ip || null, device || null, attempts, riskScore, status, riskFactorsJson, locationCity || null, locationCountry || null, getUTCNow());
}

function getProfile(userId) {
  return db().prepare("SELECT * FROM UserProfile WHERE user_id = ?").get(userId);
}

function updateProfile(userId, ip, device, loginHour) {
  const profile = getProfile(userId);
  if (!profile) return;

  let usualIp = profile.usual_ip;
  let usualDevice = profile.usual_device;
  let usualCountry = profile.usual_country;
  let hourStart = profile.usual_login_hour_start;
  let hourEnd = profile.usual_login_hour_end;
  let successfulLogins = (profile.successful_logins || 0) + 1;

  // Baseline from 10 successful logins (was 5)
  if (successfulLogins <= 10) {
    const ipCounts = db().prepare(`
      SELECT ip, COUNT(*) as cnt FROM LoginHistory 
      WHERE user_id = ? AND status = 'success' AND ip IS NOT NULL
      GROUP BY ip ORDER BY cnt DESC LIMIT 1
    `).get(userId);
    if (ipCounts) usualIp = ipCounts.ip;

    const deviceCounts = db().prepare(`
      SELECT device, COUNT(*) as cnt FROM LoginHistory 
      WHERE user_id = ? AND status = 'success' AND device IS NOT NULL
      GROUP BY device ORDER BY cnt DESC LIMIT 1
    `).get(userId);
    if (deviceCounts) usualDevice = deviceCounts.device;

    const countryRow = db().prepare(`
      SELECT location_country, COUNT(*) as cnt FROM LoginHistory 
      WHERE user_id = ? AND status = 'success' AND location_country IS NOT NULL
      GROUP BY location_country ORDER BY cnt DESC LIMIT 1
    `).get(userId);
    if (countryRow) usualCountry = countryRow.location_country;

    const hours = db().prepare(`
      SELECT CAST(strftime('%H', login_time) AS INTEGER) as h FROM LoginHistory 
      WHERE user_id = ? AND status = 'success'
    `).all(userId).map(r => r.h);
    if (hours.length > 0) {
      const avg = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
      hourStart = Math.max(0, avg - 1);
      hourEnd = Math.min(23, avg + 1);
    }
  }

  db().prepare(`
    UPDATE UserProfile SET 
      usual_ip = ?, usual_device = ?, usual_country = ?,
      usual_login_hour_start = ?, usual_login_hour_end = ?,
      successful_logins = ?
    WHERE user_id = ?
  `).run(usualIp, usualDevice, usualCountry, hourStart, hourEnd, successfulLogins, userId);
}

function recordFailedAttempt(userId, ip) {
  db().prepare(
    "INSERT INTO FailedAttempts (user_id, ip, attempt_time) VALUES (?, ?, ?)"
  ).run(userId || null, ip || null, getUTCNow());
}

function getFailedAttempts24h(userId) {
  const row = db().prepare(`
    SELECT COUNT(*) as cnt FROM FailedAttempts 
    WHERE user_id = ? AND datetime(attempt_time) > datetime('now', '-24 hours')
  `).get(userId);
  return row ? row.cnt : 0;
}

function resetFailedAttempts(userId) {
  db().prepare("DELETE FROM FailedAttempts WHERE user_id = ?").run(userId);
}

function setBlocked(userId, blocked) {
  db().prepare("UPDATE Users SET blocked = ? WHERE id = ?").run(blocked ? 1 : 0, userId);
}

function getLockedUntil(userId) {
  const row = db().prepare("SELECT locked_until FROM Users WHERE id = ?").get(userId);
  return row?.locked_until || null;
}

function setLockedUntil(userId, isoDateTimeOrNull) {
  db().prepare("UPDATE Users SET locked_until = ? WHERE id = ?").run(isoDateTimeOrNull || null, userId);
}

function getFailedAttemptsInLast5Min(userId) {
  const row = db().prepare(`
    SELECT COUNT(*) as cnt FROM FailedAttempts
    WHERE user_id = ? AND datetime(attempt_time) > datetime('now', '-5 minutes')
  `).get(userId);
  return row ? row.cnt : 0;
}

function getFailedAttemptsInLast30Sec(userId) {
  const row = db().prepare(`
    SELECT COUNT(*) as cnt FROM FailedAttempts
    WHERE user_id = ? AND datetime(attempt_time) > datetime('now', '-30 seconds')
  `).get(userId);
  return row ? row.cnt : 0;
}

function getLastSuccessfulLoginTime(userId) {
  const row = db().prepare(`
    SELECT login_time FROM LoginHistory
    WHERE user_id = ? AND status = 'success'
    ORDER BY login_time DESC LIMIT 1
  `).get(userId);
  return row?.login_time || null;
}

function getConsecutiveFailedCount(userId) {
  const rows = db().prepare(`
    SELECT status, login_time FROM LoginHistory
    WHERE user_id = ? ORDER BY login_time DESC LIMIT 20
  `).all(userId);
  let count = 0;
  for (const r of rows) {
    if (r.status === "failed") count++;
    else break;
  }
  return count;
}

function getLoginHistory(userId, limit = 10) {
  return db().prepare(`
    SELECT * FROM LoginHistory WHERE user_id = ? 
    ORDER BY login_time DESC LIMIT ?
  `).all(userId, limit);
}

function getAllUsers() {
  return db().prepare("SELECT id, username, email, created_at, blocked FROM Users").all();
}

function getAllLoginHistory(limit = 500) {
  return db().prepare(`
    SELECT l.*, u.username FROM LoginHistory l
    LEFT JOIN Users u ON l.user_id = u.id
    ORDER BY l.login_time DESC LIMIT ?
  `).all(limit);
}

function getAdminStats() {
  const totalUsers = db().prepare("SELECT COUNT(*) as c FROM Users").get().c;
  const totalLogins = db().prepare("SELECT COUNT(*) as c FROM LoginHistory").get().c;
  const suspiciousLogins = db().prepare(
    "SELECT COUNT(*) as c FROM LoginHistory WHERE risk_score >= 0.4"
  ).get().c;
  const legitimateUsers = getLegitimateUsersCount();
  return { totalUsers, totalLogins, suspiciousLogins, legitimateUsers };
}

// Legitimate users: active (not blocked) and last login risk < 0.4 (or no logins)
function getLegitimateUsersCount() {
  const dbInst = db();
  const users = dbInst.prepare("SELECT id FROM Users WHERE blocked = 0").all();
  let count = 0;
  for (const u of users) {
    const last = dbInst.prepare(`
      SELECT risk_score FROM LoginHistory WHERE user_id = ? ORDER BY login_time DESC LIMIT 1
    `).get(u.id);
    if (!last || last.risk_score === null || last.risk_score < 0.4) count++;
  }
  return count;
}

function resetUserRiskScore(userId) {
  db().prepare("UPDATE LoginHistory SET risk_score = 0 WHERE user_id = ?").run(userId);
}

function logAudit(adminAction, targetUserId, details = null) {
  db().prepare(
    "INSERT INTO AdminAuditLog (admin_action, target_user_id, details) VALUES (?, ?, ?)"
  ).run(adminAction, targetUserId, details);
}

function getLoginLocationHistory(limit = 500) {
  return db().prepare(`
    SELECT l.id, l.user_id, u.username, l.ip, l.location_city AS city, l.location_country AS country, l.login_time, l.status
    FROM LoginHistory l
    LEFT JOIN Users u ON l.user_id = u.id
    ORDER BY l.login_time DESC LIMIT ?
  `).all(limit);
}

function updateLoginLocation(loginId, city, country) {
  db().prepare("UPDATE LoginHistory SET location_city = ?, location_country = ? WHERE id = ?").run(city || null, country || null, loginId);
}

function getPasswordAttemptPatterns() {
  const dbInst = db();
  const total = dbInst.prepare("SELECT COUNT(*) as c FROM LoginHistory").get().c;
  const attempts1 = dbInst.prepare("SELECT COUNT(*) as c FROM LoginHistory WHERE attempts = 1").get().c;
  const attempts2 = dbInst.prepare("SELECT COUNT(*) as c FROM LoginHistory WHERE attempts = 2").get().c;
  const attempts3Plus = dbInst.prepare("SELECT COUNT(*) as c FROM LoginHistory WHERE attempts >= 3").get().c;
  return { total, attempts1, attempts2, attempts3Plus };
}

function getHighRiskAlerts(fromDate = null, toDate = null) {
  let sql = `
    SELECT l.id, l.user_id, u.username, l.ip, l.location_city AS city, l.location_country AS country, l.login_time, l.risk_score
    FROM LoginHistory l
    LEFT JOIN Users u ON l.user_id = u.id
    WHERE l.risk_score >= 0.75
  `;
  const params = [];
  if (fromDate) { sql += " AND datetime(l.login_time) >= datetime(?)"; params.push(fromDate); }
  if (toDate) { sql += " AND datetime(l.login_time) <= datetime(?)"; params.push(toDate); }
  sql += " ORDER BY l.login_time DESC LIMIT 500";
  return db().prepare(sql).all(...params);
}

function getTimeBasedLoginPatterns() {
  const rows = db().prepare(`
    SELECT CAST(strftime('%H', login_time) AS INTEGER) AS hour, COUNT(*) AS count
    FROM LoginHistory GROUP BY hour ORDER BY hour
  `).all();
  const byHour = Array.from({ length: 24 }, (_, i) => ({ hour: i, hourLabel: `${String(i).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`, count: 0 }));
  for (const r of rows) {
    if (r.hour >= 0 && r.hour < 24) byHour[r.hour].count = r.count;
  }
  return byHour;
}

module.exports = {
  createUser,
  findByUsername,
  findByEmail,
  findById,
  verifyPassword,
  addLoginHistory,
  getProfile,
  updateProfile,
  recordFailedAttempt,
  getFailedAttempts24h,
  getFailedAttemptsInLast5Min,
  getFailedAttemptsInLast30Sec,
  getLastSuccessfulLoginTime,
  getConsecutiveFailedCount,
  resetFailedAttempts,
  setBlocked,
  getLockedUntil,
  setLockedUntil,
  getLoginHistory,
  getAllUsers,
  getAllLoginHistory,
  getAdminStats,
  getLegitimateUsersCount,
  resetUserRiskScore,
  logAudit,
  getLoginLocationHistory,
  updateLoginLocation,
  getPasswordAttemptPatterns,
  getHighRiskAlerts,
  getTimeBasedLoginPatterns,
};
