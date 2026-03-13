/**
 * Database - SQLite via sql.js (pure JavaScript, no native deps)
 */

const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "..", "database.db");
let _db = null;

function getRow(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const hasRow = stmt.step();
  const row = hasRow ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function getAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function runSql(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

function runInsert(db, sql, params = []) {
  runSql(db, sql, params);
  const row = db.exec("SELECT last_insert_rowid() as id");
  const id = row[0]?.values[0]?.[0] ?? 0;
  save(db);
  return id;
}

function save(db) {
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    console.warn("Could not persist database:", e.message);
  }
}

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    _db = new SQL.Database(buffer);
  } else {
    _db = new SQL.Database();
  }

  _db.run = function (sql, params) {
    runSql(_db, sql, params);
    save(_db);
    const row = _db.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: row[0]?.values[0]?.[0] ?? 0 };
  };

  const schema = `
    CREATE TABLE IF NOT EXISTS Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      blocked INTEGER DEFAULT 0,
      locked_until TEXT
    );
    CREATE TABLE IF NOT EXISTS LoginHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ip TEXT,
      device TEXT,
      login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      attempts INTEGER DEFAULT 1,
      risk_score REAL,
      status TEXT,
      risk_factors TEXT
    );
    CREATE TABLE IF NOT EXISTS UserProfile (
      user_id INTEGER PRIMARY KEY,
      usual_ip TEXT,
      usual_device TEXT,
      usual_login_hour_start INTEGER,
      usual_login_hour_end INTEGER,
      successful_logins INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS FailedAttempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      ip TEXT,
      attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  _db.exec(schema);
  try { runSql(_db, "ALTER TABLE Users ADD COLUMN locked_until TEXT"); save(_db); } catch (_) {}
  try { runSql(_db, "ALTER TABLE LoginHistory ADD COLUMN risk_factors TEXT"); save(_db); } catch (_) {}
  try { runSql(_db, "ALTER TABLE Users ADD COLUMN location_city TEXT"); save(_db); } catch (_) {}
  try { runSql(_db, "ALTER TABLE Users ADD COLUMN location_country TEXT"); save(_db); } catch (_) {}
  try { runSql(_db, "ALTER TABLE LoginHistory ADD COLUMN location_city TEXT"); save(_db); } catch (_) {}
  try { runSql(_db, "ALTER TABLE LoginHistory ADD COLUMN location_country TEXT"); save(_db); } catch (_) {}
  try { runSql(_db, "ALTER TABLE UserProfile ADD COLUMN usual_country TEXT"); save(_db); } catch (_) {}
  const auditSchema = `
    CREATE TABLE IF NOT EXISTS AdminAuditLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_action TEXT NOT NULL,
      target_user_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  _db.exec(auditSchema);
  save(_db);

  console.log("Database initialized successfully");
}

function getDb() {
  if (!_db) throw new Error("Database not initialized. Call init() first.");
  return {
    prepare(sql) {
      return {
        run(...params) {
          const stmt = _db.prepare(sql);
          stmt.bind(params);
          stmt.step();
          stmt.free();
          save(_db);
          const row = _db.exec("SELECT last_insert_rowid() as id");
          return { lastInsertRowid: row[0]?.values[0]?.[0] ?? 0 };
        },
        get(...params) {
          return getRow(_db, sql, params);
        },
        all(...params) {
          return getAll(_db, sql, params);
        },
      };
    },
    exec(sql) {
      _db.exec(sql);
      save(_db);
    },
  };
}

module.exports = { init, getDb };
