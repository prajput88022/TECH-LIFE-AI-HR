// Real notification dispatch — email (SMTP), WhatsApp (Meta Cloud API), and outbound
// telephony calls (Twilio / Asterisk / FreeSWITCH). All credentials come from environment
// variables (see .env.sample) — nothing here is mocked. If credentials are missing, the
// send genuinely fails and that failure is logged and surfaced to the HR/Management user,
// rather than pretending to succeed.

const nodemailer = require("nodemailer");
const db = require("../db");
const asterisk = require("./telephony/asteriskClient");
const freeswitch = require("./telephony/freeswitchClient");

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

async function sendEmail({ to, subject, body }) {
  const tx = getTransporter();
  if (!tx) throw new Error("SMTP is not configured — set SMTP_HOST/PORT/USER/PASSWORD in .env");
  const from = process.env.SMTP_FROM_NAME
    ? `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`
    : (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER);
  const info = await tx.sendMail({ from, to, subject, text: body });
  return { messageId: info.messageId };
}

async function sendWhatsapp({ to, body }) {
  const token = process.env.WHATSAPP_API_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WhatsApp is not configured — set WHATSAPP_API_TOKEN/PHONE_NUMBER_ID in .env");
  const version = process.env.WHATSAPP_API_VERSION || "v20.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to).replace(/[^\d+]/g, ""),
      type: "text",
      text: { body },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp send failed: ${data.error?.message || res.statusText}`);
  return data;
}

async function placeCallTwilio({ to, script }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !authToken || !from) throw new Error("Twilio is not configured — set TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER in .env");

  const twiml = `<Response><Say voice="Polly.Joanna">${script.replace(/[<>&]/g, "")}</Say></Response>`;
  const params = new URLSearchParams({ To: to, From: from, Twiml: twiml });
  const auth = Buffer.from(`${sid}:${authToken}`).toString("base64");

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio call failed: ${data.message || res.statusText}`);
  return data;
}

async function placeCall({ to, script }) {
  const vendor = process.env.TELEPHONY_VENDOR || "twilio";
  if (vendor === "twilio") return placeCallTwilio({ to, script });
  if (vendor === "asterisk") {
    if (!process.env.ASTERISK_AMI_HOST) throw new Error("Asterisk is not configured — set ASTERISK_AMI_HOST/USERNAME/SECRET in .env");
    return asterisk.originateCall({
      host: process.env.ASTERISK_AMI_HOST, port: process.env.ASTERISK_AMI_PORT,
      username: process.env.ASTERISK_AMI_USERNAME, secret: process.env.ASTERISK_AMI_SECRET,
      context: process.env.ASTERISK_TRUNK_CONTEXT, toNumber: to, callerId: "Tech-Life AI HR",
    });
  }
  if (vendor === "freeswitch") {
    if (!process.env.FREESWITCH_ESL_HOST) throw new Error("FreeSWITCH is not configured — set FREESWITCH_ESL_HOST/PASSWORD in .env");
    return freeswitch.originateCall({
      host: process.env.FREESWITCH_ESL_HOST, port: process.env.FREESWITCH_ESL_PORT,
      password: process.env.FREESWITCH_ESL_PASSWORD, toNumber: to, callerId: "Tech-Life AI HR",
    });
  }
  throw new Error(`Unknown TELEPHONY_VENDOR "${vendor}" — use twilio, asterisk, or freeswitch`);
}

async function dispatch({ tenantId, candidate, channel, message, sentBy }) {
  let status = "sent";
  let providerNote = "delivered";

  try {
    if (channel === "email") { const r = await sendEmail({ to: candidate.email, subject: "Your Tech-Life AI HR link", body: message }); providerNote = r.messageId || "sent"; }
    if (channel === "whatsapp") { await sendWhatsapp({ to: candidate.phone, body: message }); }
    if (channel === "call") { await placeCall({ to: candidate.phone, script: message }); }
  } catch (err) {
    status = "failed";
    providerNote = err.message;
  }

  const record = await db.insert("notifications", {
    tenantId,
    candidateId: candidate.id,
    channel,
    target: channel === "email" ? candidate.email : candidate.phone,
    message,
    status,
    providerNote,
    sentBy: sentBy || null,
    sentAt: new Date().toISOString(),
  });

  if (status === "failed") {
    // eslint-disable-next-line no-console
    console.error(`\n[SEND FAILED - ${channel.toUpperCase()}] -> ${record.target}\nReason: ${providerNote}\n`);
  }

  return record;
}

async function testEmailConnection() {
  const tx = getTransporter();
  if (!tx) throw new Error("SMTP is not configured — set SMTP_HOST/PORT/USER/PASSWORD in .env");
  await tx.verify(); // opens a real connection to the SMTP server and checks auth, sends nothing
  return { ok: true, detail: `Connected and authenticated to ${process.env.SMTP_HOST}` };
}

async function testWhatsappConnection() {
  const token = process.env.WHATSAPP_API_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WhatsApp is not configured — set WHATSAPP_API_TOKEN/PHONE_NUMBER_ID in .env");
  const version = process.env.WHATSAPP_API_VERSION || "v20.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}?fields=verified_name,display_phone_number`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp credential check failed: ${data.error?.message || res.statusText}`);
  return { ok: true, detail: `Verified phone number: ${data.display_phone_number || phoneId} (${data.verified_name || "name unavailable"})` };
}

async function testTelephonyConnection() {
  const vendor = process.env.TELEPHONY_VENDOR || "twilio";
  if (vendor === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !authToken) throw new Error("Twilio is not configured — set TWILIO_ACCOUNT_SID/AUTH_TOKEN in .env");
    const auth = Buffer.from(`${sid}:${authToken}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: `Basic ${auth}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Twilio credential check failed: ${data.message || res.statusText}`);
    return { ok: true, detail: `Twilio account "${data.friendly_name}" — status: ${data.status}` };
  }
  if (vendor === "asterisk") {
    if (!process.env.ASTERISK_AMI_HOST) throw new Error("Asterisk is not configured — set ASTERISK_AMI_HOST/USERNAME/SECRET in .env");
    await asterisk.testLogin({ host: process.env.ASTERISK_AMI_HOST, port: process.env.ASTERISK_AMI_PORT, username: process.env.ASTERISK_AMI_USERNAME, secret: process.env.ASTERISK_AMI_SECRET });
    return { ok: true, detail: `Authenticated to Asterisk AMI at ${process.env.ASTERISK_AMI_HOST}` };
  }
  if (vendor === "freeswitch") {
    if (!process.env.FREESWITCH_ESL_HOST) throw new Error("FreeSWITCH is not configured — set FREESWITCH_ESL_HOST/PASSWORD in .env");
    await freeswitch.testLogin({ host: process.env.FREESWITCH_ESL_HOST, port: process.env.FREESWITCH_ESL_PORT, password: process.env.FREESWITCH_ESL_PASSWORD });
    return { ok: true, detail: `Authenticated to FreeSWITCH ESL at ${process.env.FREESWITCH_ESL_HOST}` };
  }
  throw new Error(`Unknown TELEPHONY_VENDOR "${vendor}"`);
}

module.exports = { dispatch, sendEmail, sendWhatsapp, placeCall, testEmailConnection, testWhatsappConnection, testTelephonyConnection };
