// Master list of features/modules that Superadmin can switch on or off per tenant.
// Adding a new feature to the platform = add one entry here.

const FEATURE_CATALOG = [
  {
    key: "candidate_management",
    label: "Candidate Management",
    description: "Add candidates, track pipeline status, view candidate profiles.",
    defaultOn: true,
  },
  {
    key: "ai_voice_interview",
    label: "AI Voice Interview (ASR + Voice AI)",
    description: "Send candidates an AI-conducted voice interview via phone/telephony.",
    defaultOn: true,
  },
  {
    key: "telephony_calling",
    label: "Telephony / Outbound Calling",
    description: "Place outbound calls to candidates through Asterisk / FreeSWITCH.",
    defaultOn: false,
  },
  {
    key: "pretest_forms",
    label: "Candidate Pre-Test / Smart Form",
    description: "Send a role & level adaptive pre-test / profile form to candidates.",
    defaultOn: true,
  },
  {
    key: "email_notifications",
    label: "Email Notifications",
    description: "Send candidate form/interview links by email.",
    defaultOn: true,
  },
  {
    key: "whatsapp_notifications",
    label: "WhatsApp Notifications",
    description: "Send candidate form/interview links by WhatsApp.",
    defaultOn: false,
  },
  {
    key: "kpi_analytics",
    label: "KPI & Performance Analytics",
    description: "Blend KPI/appraisal history into promotion-readiness scoring.",
    defaultOn: false,
  },
  {
    key: "reports_dashboard",
    label: "Reports & Activity Dashboard",
    description: "Tenant users can view pipeline reports and activity history.",
    defaultOn: true,
  },
  {
    key: "webhook_api",
    label: "Webhook / API Integration",
    description: "Expose and receive events through REST APIs and webhooks.",
    defaultOn: false,
  },
];

function defaultFeatureSet() {
  return FEATURE_CATALOG.map((f) => ({ key: f.key, enabled: !!f.defaultOn }));
}

module.exports = { FEATURE_CATALOG, defaultFeatureSet };
