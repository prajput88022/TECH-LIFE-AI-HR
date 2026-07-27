// Central place to configure every pluggable vendor the platform talks to.
// Superadmin edits these from the Integrations config page. Each category has
// exactly one active config doc (type: 'integrationConfig', category: <key>).
//
// Secrets (apiKey/secret/password) are stored as-is in CouchDB (encrypt at rest
// in production - see README "Recommendations"), and are redacted before ever
// being sent back to the browser.

const db = require("../db");

const CATEGORY_KEYS = ["llm", "stt", "tts", "bot_engine", "telephony", "meeting", "mail_server"];

// Describes each category: which vendors are selectable and which fields each vendor needs.
const CATEGORY_SCHEMA = {
  llm: {
    label: "LLM (conversation intelligence)",
    vendors: {
      anthropic: { fields: ["apiKey", "model"] },
      openai: { fields: ["apiKey", "model"] },
      custom: { fields: ["baseUrl", "apiKey", "model"] },
      none: { fields: [] },
    },
    defaultVendor: "none",
  },
  stt: {
    label: "Speech-to-Text / ASR",
    vendors: {
      browser_webspeech: { fields: [] }, // works today, no keys needed - see public/js/interview-room.js
      deepgram: { fields: ["apiKey", "model"] },
      google_stt: { fields: ["apiKey", "projectId"] },
      whisper_selfhosted: { fields: ["baseUrl"] },
      custom: { fields: ["baseUrl", "apiKey"] },
    },
    defaultVendor: "browser_webspeech",
  },
  tts: {
    label: "Text-to-Speech / Natural Voice",
    vendors: {
      browser_webspeech: { fields: [] },
      elevenlabs: { fields: ["apiKey", "voiceId"] },
      azure_tts: { fields: ["apiKey", "region", "voiceName"] },
      google_tts: { fields: ["apiKey", "voiceName"] },
      custom: { fields: ["baseUrl", "apiKey"] },
    },
    defaultVendor: "browser_webspeech",
  },
  bot_engine: {
    label: "Conversation / Bot Engine",
    vendors: {
      builtin_rules: { fields: [] }, // ships working today - src/services/botEngine.js
      rasa: { fields: ["baseUrl", "token"] },
      dialogflow: { fields: ["apiKey", "projectId"] },
      custom: { fields: ["baseUrl", "apiKey"] },
    },
    defaultVendor: "builtin_rules",
  },
  telephony: {
    label: "Telephony / Outbound Calling",
    vendors: {
      asterisk: { fields: ["amiHost", "amiPort", "amiUser", "amiSecret"] },
      freeswitch: { fields: ["eslHost", "eslPort", "eslPassword"] },
      twilio: { fields: ["accountSid", "authToken", "fromNumber"] },
      none: { fields: [] },
    },
    defaultVendor: "none",
  },
  meeting: {
    label: "Video Meeting / WebRTC",
    vendors: {
      builtin_webrtc: { fields: [] }, // ships working today - public/interview-room.html
      google_meet: { fields: ["clientId", "clientSecret"] },
      ms_teams: { fields: ["tenantId", "clientId", "clientSecret"] },
      custom: { fields: ["baseUrl", "apiKey"] },
    },
    defaultVendor: "builtin_webrtc",
  },
  mail_server: {
    label: "Mail Server (SMTP)",
    vendors: {
      smtp: { fields: ["host", "port", "secure", "user", "pass", "fromAddress"] },
      none: { fields: [] },
    },
    defaultVendor: "none",
  },
};

const SECRET_FIELDS = ["apiKey", "secret", "token", "authToken", "amiSecret", "eslPassword", "clientSecret", "pass"];

function redact(doc) {
  if (!doc) return doc;
  const copy = { ...doc };
  SECRET_FIELDS.forEach((f) => {
    if (copy[f]) copy[f] = "•".repeat(8);
  });
  return copy;
}

async function getConfig(category) {
  const doc = await db.find("integrationConfig", (c) => c.category === category);
  if (doc) return doc;
  const schema = CATEGORY_SCHEMA[category];
  return { category, vendor: schema.defaultVendor, enabled: schema.defaultVendor !== "none" };
}

async function getAllConfigs() {
  const out = {};
  for (const key of CATEGORY_KEYS) {
    const cfg = await getConfig(key);
    out[key] = { ...CATEGORY_SCHEMA[key], config: redact(cfg) };
  }
  return out;
}

async function saveConfig(category, payload) {
  const existing = await db.find("integrationConfig", (c) => c.category === category);
  const clean = { category, vendor: payload.vendor, enabled: !!payload.enabled, updatedAt: new Date().toISOString() };
  const schema = CATEGORY_SCHEMA[category];
  const fields = (schema.vendors[payload.vendor] || {}).fields || [];
  fields.forEach((f) => { clean[f] = payload[f] ?? (existing ? existing[f] : ""); });

  if (existing) return db.update("integrationConfig", existing.id, clean);
  return db.insert("integrationConfig", clean);
}

// Used internally by services (notifyService, interview engine) - returns the
// *unredacted* live config so real credentials can be used to call the vendor.
async function getConfigRaw(category) {
  return getConfig(category);
}

module.exports = { CATEGORY_KEYS, CATEGORY_SCHEMA, getConfig, getAllConfigs, saveConfig, redact, getConfigRaw };
