/**
 * E2E Login Risk Simulation - Strict assertions
 * Run: node test-login-simulation.js
 * Requires: Server on :3000, ML service on :8000
 */

const fetch = require("node-fetch");

const BASE = "http://localhost:3000";
let cookies = "";
let testsPassed = 0;
let testsFailed = 0;

function getRandomIp() {
  return Array(4).fill(0).map(() => Math.floor(Math.random() * 256)).join(".");
}

function getRandomDevice() {
  const devices = ["iPhone Safari", "Android Chrome", "Linux Firefox", "Mac Safari"];
  return devices[Math.floor(Math.random() * devices.length)];
}

async function request(path, options = {}) {
  const url = BASE + path;
  const headers = {
    "Content-Type": "application/json",
    ...(cookies ? { Cookie: cookies } : {}),
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  let setCookie = [];
  try {
    setCookie = res.headers.raw()["set-cookie"] || [];
  } catch {
    const sc = res.headers.get("set-cookie");
    if (sc) setCookie = [sc];
  }
  if (setCookie.length) {
    cookies = setCookie.map((c) => String(c).split(";")[0]).join("; ");
  }
  return res;
}

async function register(user, pass, email) {
  return request("/api/register", {
    method: "POST",
    body: JSON.stringify({ username: user, email, password: pass }),
  });
}

async function login(user, pass, testIp, testDevice) {
  const body = { username: user, password: pass };
  if (testIp) body.testIp = testIp;
  if (testDevice) body.testDevice = testDevice;
  return request("/api/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function adaptiveAnswer(answer) {
  return request("/api/adaptive-answer", {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
}

function log(msg, type = "info") {
  const icons = { info: "→", pass: "✓", fail: "✗", warn: "!" };
  console.log(`  ${icons[type] || "→"} ${msg}`);
}

function assert(cond, msg) {
  if (!cond) {
    log(msg, "fail");
    testsFailed++;
    return false;
  }
  testsPassed++;
  return true;
}

async function runTests() {
  const useExisting = process.env.TEST_USER && process.env.TEST_PASS;
  const user = useExisting ? process.env.TEST_USER : "testuser_" + Date.now();
  const pass = useExisting ? process.env.TEST_PASS : "TestPass123!";
  const email = useExisting ? "skip@test.com" : `test_${Date.now()}@test.com`;

  console.log("\n========================================");
  console.log("  FL-AHPS - Login Risk E2E Tests");
  console.log("========================================\n");
  if (useExisting) log(`Using existing user: ${user}`, "info");

  // Check services
  try {
    const mlRes = await fetch("http://localhost:8000/health");
    assert(mlRes.ok, "ML service must be running on port 8000");
    log("ML service OK (port 8000)", "pass");
  } catch (e) {
    log("ML service not running - run: python -m uvicorn ml_service.app:app --port 8000", "fail");
    process.exit(1);
  }
  try {
    await fetch(BASE + "/");
    log("Node server OK (port 3000)", "pass");
  } catch (e) {
    log("Node server not running - run: node server.js", "fail");
    process.exit(1);
  }

  let testUser = user, testPass = pass;
  if (!useExisting) {
    console.log("\n[1] Create test user");
    const createRes = await fetch(BASE + "/api/test-create-user", { method: "POST" });
    const createData = await createRes.json().catch(() => ({}));
    assert(createRes.ok, "test-create-user failed: " + (createData.error || createRes.status));
    testUser = createData.username;
    testPass = createData.password || "SimTest123!";
    log(`Using: ${testUser}`, "pass");
  } else {
    console.log("\n[1] Using TEST_USER");
  }

  // Reset simtest failed attempts so each run starts clean
  if (testUser === "simtest") {
    await fetch(BASE + "/api/test-reset-simtest", { method: "POST" });
  }

  // --- [2] Normal login must be LOW RISK → dashboard ---
  console.log("\n[2] Normal login (same IP, no failures) → must be dashboard, risk < 30%");
  cookies = "";
  const normRes = await login(testUser, testPass);
  const normData = await normRes.json();
  if (normRes.status === 401 && useExisting) {
    assert(false, "Invalid TEST_USER/TEST_PASS");
  } else if (!normRes.ok) {
    assert(false, "Normal login should succeed: " + (normData.error || normRes.status));
  } else {
    assert(normData.action === "dashboard", "Expected action=dashboard, got " + normData.action);
    assert(normData.riskScore < 0.3, "Normal login risk must be < 30%, got " + (normData.riskScore * 100).toFixed(1) + "%");
    log(`Risk: ${(normData.riskScore * 100).toFixed(1)}% → Dashboard`, "pass");
  }

  // --- [3] Wrong password 3x ---
  console.log("\n[3] Wrong password x3");
  cookies = "";
  for (let i = 0; i < 3; i++) {
    const failRes = await login(testUser, "wrongpass");
    assert(failRes.status === 401, "Wrong password must return 401");
  }
  log("All 3 attempts rejected", "pass");

  // --- [4] Login after 3 failures → elevated risk (adaptive or blocked) ---
  console.log("\n[4] Login after 3 failures (correct password) → risk >= 30%");
  const afterFailRes = await login(testUser, testPass);
  const afterFailData = await afterFailRes.json();
  if (!afterFailRes.ok) {
    assert(false, "Login after failures should succeed: " + (afterFailData.error || afterFailRes.status));
  } else {
    assert(afterFailData.riskScore >= 0.3, "Risk after failures must be >= 30%, got " + (afterFailData.riskScore * 100).toFixed(1) + "%");
    assert(["adaptive", "blocked"].includes(afterFailData.action), "Expected adaptive or blocked, got " + afterFailData.action);
    log(`Risk: ${(afterFailData.riskScore * 100).toFixed(1)}% → ${afterFailData.action}`, "pass");
  }

  // Complete adaptive so failures are cleared (success clears failed_attempts)
  if (afterFailRes.ok && afterFailData.action === "adaptive") {
    const completeRes = await adaptiveAnswer("yes");
    const completeData = await completeRes.json();
    assert(completeRes.ok && completeData.action === "dashboard", "Complete adaptive to clear failures");
  }

  // --- [5] Success clears failures; next login same IP → low risk dashboard ---
  console.log("\n[5] After success, login again (same IP) → dashboard, risk < 30%");
  cookies = "";
  const againRes = await login(testUser, testPass);
  const againData = await againRes.json();
  if (!againRes.ok) {
    assert(false, "Re-login should succeed");
  } else {
    assert(againData.action === "dashboard", "Expected dashboard after clear, got " + againData.action);
    assert(againData.riskScore < 0.3, "Risk after clear must be < 30%, got " + (againData.riskScore * 100).toFixed(1) + "%");
    log(`Risk: ${(againData.riskScore * 100).toFixed(1)}% → Dashboard`, "pass");
  }

  // --- [6] New IP only → login succeeds (model may give dashboard or adaptive) ---
  console.log("\n[6] New IP only");
  cookies = "";
  const newIp = getRandomIp();
  const ipRes = await login(testUser, testPass, newIp);
  const ipData = await ipRes.json();
  if (!ipRes.ok) {
    assert(false, "Login with new IP should succeed");
  } else {
    assert(["dashboard", "adaptive", "blocked"].includes(ipData.action), "Valid action, got " + ipData.action);
    assert(typeof ipData.riskScore === "number" && ipData.riskScore >= 0 && ipData.riskScore <= 1, "Valid risk score");
    log(`IP: ${newIp} | Risk: ${(ipData.riskScore * 100).toFixed(1)}% → ${ipData.action}`, "pass");
  }

  // --- [7] High risk: 3 failures + new IP + new device → blocked (>= 75%) or adaptive ---
  console.log("\n[7] HIGH RISK: 3 failures + New IP + New device → blocked or adaptive");
  cookies = "";
  for (let i = 0; i < 3; i++) await login(testUser, "wrong");
  const highIp = getRandomIp();
  const highDev = getRandomDevice();
  const highRes = await login(testUser, testPass, highIp, highDev);
  const highData = await highRes.json();
  if (!highRes.ok) {
    assert(false, "High-risk login should return 200");
  } else {
    assert(highData.riskScore >= 0.3, "High-risk score must be >= 30%, got " + (highData.riskScore * 100).toFixed(1) + "%");
    assert(["adaptive", "blocked"].includes(highData.action), "Expected adaptive or blocked, got " + highData.action);
    if (highData.riskScore >= 0.7) {
      log(`Risk: ${(highData.riskScore * 100).toFixed(1)}% → BLOCKED`, "pass");
    } else {
      log(`Risk: ${(highData.riskScore * 100).toFixed(1)}% → ${highData.action}`, "pass");
    }
  }

  // --- [8] Adaptive flow: trigger adaptive, then answer "yes" → dashboard ---
  console.log("\n[8] Adaptive flow: 2 failures + new IP → adaptive, answer yes → dashboard");
  cookies = "";
  for (let i = 0; i < 2; i++) await login(testUser, "wrong");
  const adaptIp = getRandomIp();
  const adaptRes = await login(testUser, testPass, adaptIp);
  const adaptData = await adaptRes.json();
  if (!adaptRes.ok || adaptData.action !== "adaptive") {
    assert(false, "Should get adaptive challenge, got " + (adaptData.action || adaptData.error));
  } else {
    const answerRes = await adaptiveAnswer("yes");
    const answerData = await answerRes.json();
    assert(answerRes.ok && answerData.success && answerData.action === "dashboard", "Answer yes should grant dashboard");
    log("Adaptive answer yes → dashboard", "pass");
  }

  // --- [9] API validation: login without password → 400 ---
  console.log("\n[9] API validation: login without password → 400");
  const badLoginRes = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: testUser }),
  });
  assert(badLoginRes.status === 400, "Missing password should return 400");
  log("Missing password returns 400", "pass");

  // --- [10] Reset failed attempts (logged-in user) ---
  console.log("\n[10] Reset failed attempts (when logged in)");
  cookies = "";
  const loginForReset = await login(testUser, testPass);
  const loginForResetData = await loginForReset.json();
  if (!loginForReset.ok) {
    assert(false, "Login for reset must succeed");
  } else {
    const resetRes = await request("/api/reset-failed-attempts", { method: "POST" });
    const resetData = await resetRes.json().catch(() => ({}));
    assert(resetRes.ok && resetData.success, "Reset failed attempts should succeed");
    log("Reset failed attempts OK", "pass");
  }

  console.log("\n========================================");
  console.log(`  Result: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("========================================\n");
  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});

