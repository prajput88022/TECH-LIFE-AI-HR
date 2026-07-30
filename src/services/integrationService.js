// Integration STATUS reporting. As of this version, no credentials are stored in CouchDB —
// every real secret lives only in environment variables (see .env.sample). This module just
// reports, for the Superadmin Integrations screen, which vendor is active per category and
// whether it's fully configured (i.e. its required env vars are present) — read-only.

function present(name) { return !!(process.env[name] && process.env[name].trim()); }

function buildStatus() {
  const telephonyVendor = process.env.TELEPHONY_VENDOR || "twilio";
  const telephonyRequirements = {
    twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
    asterisk: ["ASTERISK_AMI_HOST", "ASTERISK_AMI_USERNAME", "ASTERISK_AMI_SECRET"],
    freeswitch: ["FREESWITCH_ESL_HOST", "FREESWITCH_ESL_PASSWORD"],
  }[telephonyVendor] || [];

  return {
    couchdb: {
      label: "CouchDB (database)",
      vendor: process.env.COUCHDB_URL || process.env.COUCHDB_HOST ? "real-couchdb" : "embedded-pouchdb",
      configured: !!(process.env.COUCHDB_URL || process.env.COUCHDB_HOST),
      envVars: ["COUCHDB_URL", "or COUCHDB_HOST/PORT/USER/PASSWORD/DBNAME"],
      note: process.env.COUCHDB_URL || process.env.COUCHDB_HOST ? "Connected to a real CouchDB server." : "Running on the embedded local store — set COUCHDB_URL or COUCHDB_HOST for a real deployment.",
    },
    mail_server: {
      label: "Mail server (SMTP)",
      vendor: "smtp",
      configured: present("SMTP_HOST") && present("SMTP_USER"),
      envVars: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL"],
    },
    whatsapp: {
      label: "WhatsApp (Meta Cloud API)",
      vendor: "whatsapp_cloud_api",
      configured: present("WHATSAPP_API_TOKEN") && present("WHATSAPP_PHONE_NUMBER_ID"),
      envVars: ["WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    },
    telephony: {
      label: "Telephony / Outbound Calling",
      vendor: telephonyVendor,
      configured: telephonyRequirements.every(present),
      envVars: ["TELEPHONY_VENDOR", ...telephonyRequirements],
    },
    webhooks: {
      label: "Outbound Webhooks",
      vendor: "http-hmac",
      configured: present("WEBHOOK_URLS") && present("WEBHOOK_SECRET"),
      envVars: ["WEBHOOK_URLS", "WEBHOOK_SECRET"],
    },
    meeting: {
      label: "Video Meeting",
      vendor: process.env.MEETING_VENDOR || (present("MATTERMOST_URL") ? "mattermost" : "builtin_webrtc"),
      configured: (process.env.MEETING_VENDOR || (present("MATTERMOST_URL") ? "mattermost" : "builtin_webrtc")) === "builtin_webrtc"
        ? true
        : present("MATTERMOST_URL") && present("MATTERMOST_TEAM") && present("MATTERMOST_CHANNEL_NAME"),
      envVars: ["MEETING_VENDOR", "MATTERMOST_URL", "MATTERMOST_TEAM", "MATTERMOST_CHANNEL_NAME"],
      note: (process.env.MEETING_VENDOR || "builtin_webrtc") === "builtin_webrtc"
        ? "Using the platform's own WebRTC room — works today with no setup."
        : "Meeting links point to a Mattermost channel with Calls enabled on it.",
    },
    team_chat: {
      label: "Team Chat Notifications (Mattermost)",
      vendor: "mattermost_incoming_webhook",
      configured: present("MATTERMOST_WEBHOOK_URL"),
      envVars: ["MATTERMOST_WEBHOOK_URL", "MATTERMOST_CHANNEL"],
      note: "Posts real-time alerts (anger detected on a call, a case needs Management approval) to an HR/ops Mattermost channel via a real Incoming Webhook.",
    },
    chatwoot: {
      label: "Candidate Live Chat (Chatwoot)",
      vendor: "chatwoot",
      configured: present("CHATWOOT_URL") && present("CHATWOOT_API_TOKEN") && present("CHATWOOT_ACCOUNT_ID") && present("CHATWOOT_INBOX_ID"),
      envVars: ["CHATWOOT_URL", "CHATWOOT_API_TOKEN", "CHATWOOT_ACCOUNT_ID", "CHATWOOT_INBOX_ID"],
      note: "Message candidates through a real Chatwoot conversation (visible to your whole HR team in Chatwoot's own inbox) instead of/alongside email or WhatsApp.",
    },
    stt: {
      label: "Speech-to-Text (ASR)",
      vendor: process.env.STT_PROVIDER || "browser_webspeech",
      configured: process.env.STT_PROVIDER ? present("STT_API_KEY") : true,
      envVars: ["STT_PROVIDER", "STT_API_KEY"],
      note: process.env.STT_PROVIDER ? undefined : "Using the browser's built-in Web Speech API — works today with no keys.",
    },
    tts: {
      label: "Text-to-Speech (voice)",
      vendor: process.env.TTS_PROVIDER || "browser_webspeech",
      configured: process.env.TTS_PROVIDER ? present("TTS_API_KEY") : true,
      envVars: ["TTS_PROVIDER", "TTS_API_KEY"],
      note: process.env.TTS_PROVIDER ? undefined : "Using the browser's built-in Web Speech API — works today with no keys.",
    },
    llm: {
      label: "LLM",
      vendor: process.env.LLM_PROVIDER || "none",
      configured: process.env.LLM_PROVIDER ? present("LLM_API_KEY") : false,
      envVars: ["LLM_PROVIDER", "LLM_API_KEY"],
      note: process.env.LLM_PROVIDER ? undefined : "Not configured — the platform uses its built-in rules-based question engine instead.",
    },
  };
}

module.exports = { buildStatus };
