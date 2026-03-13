# FL-AHPS – AI-Based Account Hijack Prevention

**Zero Trust • ML-Powered Risk Scoring • Adaptive Authentication**

FL-AHPS is a full-stack login security system that scores each login attempt by risk (0–100%), applies calibrated thresholds, and can trigger an adaptive challenge or block. It learns your usual IP, device, and login time to detect anomalies and explains why a given login was flagged.

---

## Quick Start

### 1. Install Dependencies

```bash
# Node.js (backend + frontend)
npm install

# Python (ML service)
pip install -r requirements.txt
# Or minimal: pip install fastapi uvicorn joblib pydantic
```

### 2. Train the ML Model (first time only)

```bash
python train_model.py
```

This reads `data.csv`, trains a Random Forest classifier, and saves `ml_service/login_risk_model.pkl`.

### 3. Run the Application

**Option A – Windows (both services)**  
```bash
start-all.bat
```

**Option B – Two terminals**

```bash
# Terminal 1 – ML service (port 8000)
python -m uvicorn ml_service.app:app --host 0.0.0.0 --port 8000

# Terminal 2 – Node server (port 3000)
node server.js
```

### 4. Access

| What        | URL                        |
|------------|----------------------------|
| App        | http://localhost:3000      |
| Login      | http://localhost:3000/login.html |
| Admin      | http://localhost:3000/admin.html  |
| Admin login| `admin` / `admin123`       |

---

## Testing

Both **ML service (port 8000)** and **Node server (port 3000)** must be running.

```bash
npm run test
```

- Uses test user `simtest` / `SimTest123!` (created via `/api/test-create-user`).
- Resets failed attempts and lock before run for consistent results.
- Covers: create user, normal login, wrong password, elevated risk, adaptive flow, API validation, reset attempts.

---

## Project Structure

```
/project-root
├── server.js                 # Express app, session, routes, /api/me, test hooks
├── database.db               # SQLite (auto-created)
├── package.json
├── requirements.txt
├── train_model.py            # Train Random Forest, save .pkl
├── start-all.bat             # Start ML + Node (Windows)
├── test-login-simulation.js  # E2E login + risk tests
├── data.csv  # Training data (7 features + label)
│
├── routes/
│   ├── auth.js               # Register, login, calibrated risk, adaptive, lock
│   └── admin.js              # Admin login, stats, users, logins, block/unblock
│
├── models/
│   ├── db.js                 # SQLite (sql.js), schema, migrations
│   └── user.js               # Users, profiles, login history, failed attempts, lock
│
├── public/
│   ├── index.html            # Landing
│   ├── login.html            # Login (optional IP/device simulation)
│   ├── register.html
│   ├── dashboard.html       # Risk trend, category pie, “Why this risk?”, history
│   ├── adaptive_question.html
│   ├── blocked.html
│   ├── admin.html            # Stats, risk distribution, user/login tables
│   ├── styles.css
│   ├── theme.js
│   └── ...
│
└── ml_service/
    ├── app.py                # FastAPI: /predict (7 features → risk_score), /health
    ├── login_risk_model.pkl  # Trained model (from train_model.py)
    └── requirements.txt
```

---

## Features (Detailed)

### User & Auth

- **Registration** – Username, email, password (bcrypt). Duplicate username/email rejected.
- **Login** – Validates credentials, computes risk, then allows / adaptive challenge / block.
- **Optional simulation** – Login form can send `testIp` and `testDevice` for demos (same as “real” IP/device for risk logic).

### Risk Calibration

- **Base risk** – Each login starts at 5–15% (random in that range) so risk doesn’t jump from 0% to 50%.
- **Additive factors** (capped so the total grows gradually):
  - Failed login attempts (24h): up to ~35%.
  - Unusual login time: up to 20%.
  - New location / IP: 15%.
  - New device: 10%.
  - Rapid attempts (3+ in 30 seconds): 15%.
  - High login frequency (2+ in 5 minutes): 10%.
- **Decay** – If the last successful login was more than 5 minutes ago and there are no failed attempts in the last 5 minutes, the “failed attempts” component is reduced by 60%.
- **Final score** – Formula total (75%) + ML score (25%), capped at 100%.

### Decision Thresholds

| Risk        | Action           |
|------------|------------------|
| &lt; 30%   | Allow → Dashboard |
| 30% – 70%  | Adaptive question |
| ≥ 70%      | Blocked          |

### “Why this risk?” (Dashboard)

- Expandable **“Why this risk?”** section shows the last login’s **contributing factors**.
- Each line: **+X%** factor name and short reason (e.g. “3 wrong password(s) recently”, “Outside your usual login hours”, “Login from an unfamiliar IP”).

### Feature Engineering

- **Core (for ML):** `ip_new`, `location_new`, `device_new`, `time_deviation`, `password_attempts`, `failed_attempts_24h`, `geo_distance`.
- **Extra (for calibration & factors):**
  - Login frequency in last 5 minutes.
  - Rapid attempt flag (3+ attempts in 30 seconds).
  - Consecutive failed count (from login history).
  - Session age / last success time (for decay).

### Adaptive Question

- **Dynamic** – Built from user history and profile, e.g.:
  - “Your last login was from [IP]. Is this you logging in again from a different location?”
  - “You usually login between X:00 and Y:00. Is this you?”
  - “Is this your regular device ([device])?”
- Answer **Yes** → success, update profile, clear failed attempts. **No** → treat as blocked.

### Account Lock (Temporary)

- **5 consecutive failed logins** → account locked for **10 minutes**.
- Login returns **423** with a message like “Try again in X minute(s).”
- Lock stored in `Users.locked_until`; test-reset endpoint also clears it for the test user.

### Dashboard Charts

- **Risk Score Trend** – Line chart of the last 10 logins (risk %).
- **Risk Category (Last 10)** – Doughnut: Low (&lt;30%), Medium (30–70%), High (≥70%).
- **Login Status** – Success / Failed / Blocked counts.

### Admin Panel

- Admin login: `admin` / `admin123`.
- Stats: total users, logins, suspicious logins (risk ≥ 30%).
- Risk distribution (low / medium / high by current thresholds).
- Tables: users (block/unblock), recent logins.
- Reset failed attempts per user.

### Learning (Profile)

- First **5 successful logins** build the baseline: usual IP, usual device, usual login hour range.
- Later logins are compared to this profile for “new IP”, “new device”, “unusual time”.

---

## How Risk Score Works (Summary)

1. **Features** – From current request + profile + failed-attempt and login-history tables (IP, device, time, counts, rapid flag, etc.).
2. **Formula** – Base 5–15% plus additive factors (with decay when applicable).
3. **ML** – Optional 7-feature vector sent to ML service; score blended with formula (25% weight).
4. **Decision** – Compare final score to 30% and 70% → allow / adaptive / block.
5. **Storage** – Each login stores `risk_score` and `risk_factors` (JSON) in `LoginHistory` for dashboard and charts.

---

## Tech Stack

| Layer    | Tech |
|----------|------|
| Frontend | HTML, CSS, Vanilla JS, Chart.js (CDN), theme toggle |
| Backend  | Node.js, Express, express-session |
| Database | SQLite via sql.js (no native bindings) |
| ML      | Python, FastAPI, scikit-learn Random Forest, joblib |

---

## API Overview (Key Endpoints)

| Method | Path | Description |
|--------|------|-------------|
| POST   | /api/register | Register (username, email, password) |
| POST   | /api/login | Login (username, password; optional testIp, testDevice) |
| POST   | /api/logout | Logout |
| GET    | /api/me | Current user, profile, history (with risk_factors) |
| POST   | /api/reset-failed-attempts | Clear failed attempts for current user |
| POST   | /api/adaptive-answer | Answer adaptive question (answer: "yes" / "no") |
| GET    | /api/adaptive-question | Get dynamic question for pending login |
| POST   | /api/admin/login | Admin login |
| GET    | /api/admin/stats, /users, /logins, /risk-distribution | Admin data |
| POST   | /api/admin/block/:userId, /unblock/:userId, /reset-attempts/:userId | Admin actions |

Dev/test-only (remove or protect in production):

- `POST /api/test-create-user` – Ensure user `simtest` / `SimTest123!` exists.
- `POST /api/test-reset-simtest` – Reset failed attempts and lock for `simtest`.
- `GET /api/debug/history` – Raw login history for current user.

---

## Environment

- **Ports** – Node: 3000, ML: 8000 (configurable via `PORT` and ML app).
- **Database** – `database.db` in project root; created and migrated automatically.
- **Session** – In-memory; secret in code (use env in production).

---

## License & Disclaimer

This is a demo project. Before production use: secure secrets (env vars), enable HTTPS, restrict or remove test/debug endpoints, and consider rate limiting and audit logging.
