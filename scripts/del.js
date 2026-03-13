/**
 * Delete all user data from SQLite; keep AdminAuditLog (admin data).
 * Run: node scripts/clear-user-data.js
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const dbModule = require("../models/db");
  await dbModule.init();
  const db = dbModule.getDb();

  db.prepare("DELETE FROM LoginHistory").run();
  db.prepare("DELETE FROM FailedAttempts").run();
  db.prepare("DELETE FROM UserProfile").run();
  db.prepare("DELETE FROM Users").run();

  console.log("Done. Cleared: Users, UserProfile, LoginHistory, FailedAttempts. Kept: AdminAuditLog.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
