// Pluggable notification service — email / WhatsApp / outbound call.
//
// Reads the active vendor + credentials for "mail_server" and "telephony" from
// integrationService (configured on the Superadmin > Integrations page).
// If NOTIFY_MODE=live and a real vendor is configured, the real* functions
// below are used; otherwise everything is logged to the notifications
// collection and printed to the console so the full flow can be exercised
// end-to-end without any outbound network access (this sandbox has none).

const nodemailer = require("nodemailer");
const db = require("../db");
const integrations = require("./integrationService");

const MOCK_MODE = process.env.NOTIFY_MODE !== "live";

async function sendEmailReal({ to, subject, body }) {
  const cfg = await integrations.getConfigRaw("mail_server");
  if (!cfg.enabled || cfg.vendor !== "smtp") throw new Error("No live SMTP mail server configured");
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || 587,
    secure: !!cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  await transporter.sendMail({ from: cfg.fromAddress || cfg.user, to, subject, text: body });
}

async function sendWhatsappReal({ to, body }) {
  // Plug a real WhatsApp Cloud API / Twilio WhatsApp call here using the
  // "telephony" or a dedicated "whatsapp" integrationConfig entry.
  throw new Error("Live WhatsApp provider not wired yet - see src/services/notifyService.js");
}

async function placeCallReal({ to, script }) {
  const cfg = await integrations.getConfigRaw("telephony");
  if (!cfg.enabled || cfg.vendor === "none") throw new Error("No live telephony vendor configured");
  // Real integrations go here, keyed by vendor:
  //  - asterisk: open an AMI socket (cfg.amiHost/amiPort/amiUser/amiSecret) and Originate a call
  //  - freeswitch: connect via ESL (cfg.eslHost/eslPort/eslPassword) and run `originate`
  //  - twilio: call the REST API with cfg.accountSid/authToken/fromNumber
  throw new Error(`Live telephony vendor "${cfg.vendor}" not wired yet - see src/services/notifyService.js`);
}

async function dispatch({ tenantId, candidate, channel, message, sentBy }) {
  let status = "sent";
  let providerNote = "mock-delivered";

  try {
    if (!MOCK_MODE) {
      if (channel === "email") await sendEmailReal({ to: candidate.email, subject: "Your Tech-Life AI HR link", body: message });
      if (channel === "whatsapp") await sendWhatsappReal({ to: candidate.phone, body: message });
      if (channel === "call") await placeCallReal({ to: candidate.phone, script: message });
    }
  } catch (err) {
    status = "failed";
    providerNote = err.message;
  }

  const record = await db.insert("notifications", {
    tenantId,
    candidateId: candidate.id,
    channel, // 'email' | 'whatsapp' | 'call'
    target: channel === "email" ? candidate.email : candidate.phone,
    message,
    status,
    providerNote,
    mode: MOCK_MODE ? "mock" : "live",
    sentBy: sentBy || null,
    sentAt: new Date().toISOString(),
  });

  if (MOCK_MODE || status === "failed") {
    // eslint-disable-next-line no-console
    console.log(`\n[${status === "failed" ? "FAILED " : "MOCK "}${channel.toUpperCase()}] -> ${record.target}\n${message}\n${status === "failed" ? "Reason: " + providerNote : ""}\n`);
  }

  return record;
}

module.exports = { dispatch, MOCK_MODE };
