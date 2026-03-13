"""
Brevo (Sendinblue) Email Service - Security Alerts
FL-AHPS - Sends security alert emails via Brevo SMTP.
"""

import os
import sys
import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Load .env if present (optional)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except ImportError:
    pass

SUBJECT = "Suspicious Login Attempt Detected"

def get_env(key, default=None):
    return os.environ.get(key, default)

def send_security_alert(user_email, ip, city, country, device, time, risk_score):
    """
    Send security alert email via Brevo SMTP.
    """
    host = get_env("BREVO_SMTP_HOST", "smtp-relay.brevo.com")
    port = int(get_env("BREVO_SMTP_PORT", "587"))
    user = get_env("BREVO_SMTP_USER")
    password = get_env("BREVO_SMTP_PASS")
    sender_email = get_env("BREVO_SENDER_EMAIL")
    sender_name = get_env("BREVO_SENDER_NAME", "FL-AHPS")

    if not all([user, password, sender_email]):
        raise ValueError("Missing Brevo SMTP config: set BREVO_SMTP_USER, BREVO_SMTP_PASS, BREVO_SENDER_EMAIL")

    risk_pct = f"{(float(risk_score) * 100):.1f}%" if risk_score is not None else "N/A"
    city = city or "—"
    country = country or "—"
    device = device or "—"
    time_str = str(time) if time else "—"
    ip = ip or "—"

    body = f"""Suspicious login attempt detected from a new location.

IP Address: {ip}
Location: {city}, {country}
Device: {device}
Time: {time_str}
Risk Score: {risk_pct}

If this wasn't you, please secure your account immediately."""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = SUBJECT
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = user_email
    msg.attach(MIMEText(body, "plain"))

    with smtplib.SMTP(host, port) as server:
        server.starttls()
        server.login(user, password)
        server.sendmail(sender_email, user_email, msg.as_string())

    return True


def main():
    """Read JSON from argv[1] or stdin and send alert."""
    if len(sys.argv) > 1:
        data = json.loads(sys.argv[1])
    else:
        data = json.load(sys.stdin)

    send_security_alert(
        user_email=data.get("user_email", ""),
        ip=data.get("ip", ""),
        city=data.get("city", ""),
        country=data.get("country", ""),
        device=data.get("device", ""),
        time=data.get("time", ""),
        risk_score=data.get("risk_score"),
    )
    print("OK", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
