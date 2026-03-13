/**
 * Create a user (or set password if username exists).
 * Run: node scripts/create-user.js <username> <password> [email]
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const db = require("../models/db");
  const userModel = require("../models/user");

  const username = process.argv[2];
  const password = process.argv[3];
  const email = process.argv[4] || username + "@secureguard.local";

  if (!username || !password) {
    console.log("Usage: node scripts/create-user.js <username> <password> [email]");
    process.exit(1);
  }

  await db.init();

  const existing = userModel.findByUsername(username);
  if (existing) {
    const bcrypt = require("bcrypt");
    const hash = bcrypt.hashSync(password, 10);
    db.getDb().prepare("UPDATE Users SET password_hash = ? WHERE id = ?").run(hash, existing.id);
    console.log("Password updated for user:", username);
    return;
  }

  if (userModel.findByEmail(email)) {
    console.log("Email already exists:", email);
    process.exit(1);
  }

  const userId = userModel.createUser(username, email, password, "127.0.0.1", "Script", null, null);
  console.log("Created user:", username, "| email:", email, "| id:", userId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
