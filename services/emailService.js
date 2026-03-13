/**
 * Security alert email via Brevo (Sendinblue) SMTP.
 * FL-AHPS - Uses same credentials as email_service/brevo_email.py.
 */

const nodemailer = require("nodemailer");

const SUBJECT = "Suspicious Login Attempt Detected";

function getTransport() {
  const host = process.env.BREVO_SMTP_HOST || "smtp-relay.brevo.com";
  const port = parseInt(process.env.BREVO_SMTP_PORT || "587", 10);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: false, auth: { user, pass } });
}

function sendSecurityAlert(user_email, ip, city, country, device, time, risk_score) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_USER;
  const senderName = process.env.BREVO_SENDER_NAME || "FL-AHPS";
  const risk_pct = risk_score != null ? `${(Number(risk_score) * 100).toFixed(1)}%` : "N/A";
  const body = `Suspicious login attempt detected from a new location.

IP Address: ${ip || "—"}
Location: ${city || "—"}, ${country || "—"}
Device: ${device || "—"}
Time: ${time || "—"}
Risk Score: ${risk_pct}

If this wasn't you, please secure your account immediately.`;

  const transport = getTransport();
  if (!transport) {
    console.warn("[Email] Brevo SMTP not configured (BREVO_SMTP_USER/PASS). Skip send.");
    return Promise.resolve();
  }

  console.log("[Email] Sending security alert to", user_email);
  return transport
    .sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: user_email,
      subject: SUBJECT,
      text: body,
    })
    .then((info) => {
      console.log("[Email] Sent successfully to", user_email, info.messageId || "");
      return info;
    })
    .catch((err) => {
      console.error("[Email] Send failed:", err.message);
      if (err.response) console.error("[Email] Response:", err.response);
      throw err;
    });
}

module.exports = { sendSecurityAlert };

