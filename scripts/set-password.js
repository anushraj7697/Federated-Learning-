/**
 * One-time script: set a user's password (by username or email).
 * Run: node scripts/set-password.js <username-or-email> <new-password>
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const db = require("../models/db");
  const bcrypt = require("bcrypt");

  const identifier = process.argv[2];
  const newPassword = process.argv[3];

  if (!identifier || !newPassword) {
    console.log("Usage: node scripts/set-password.js <username-or-email> <new-password>");
    process.exit(1);
  }

  await db.init();
  const dbInst = db.getDb();
  const user = dbInst.prepare(
    "SELECT id, username FROM Users WHERE username = ? OR email = ?"
  ).get(identifier, identifier);

  if (!user) {
    console.log("User not found:", identifier);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  dbInst.prepare("UPDATE Users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  console.log("Password updated for user:", user.username, "(id:", user.id + ")");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
