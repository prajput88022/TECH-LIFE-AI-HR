const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth, requireRole, requireFeature, scopeTenantId } = require("../middleware/auth");
const activity = require("../services/activityService");
const notify = require("../services/notifyService");
const webhooks = require("../services/webhookService");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"));

function tenantOf(req) {
  const id = scopeTenantId(req);
  if (!id) throw Object.assign(new Error("tenantId is required for this action"), { status: 400 });
  return id;
}

router.get("/", async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const candidates = (await db.all("candidates", (c) => c.tenantId === tenantId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ candidates });
});

router.post("/", requireFeature("candidate_management"), async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  const { name, email, phone, industry, level, appliedRole, caseType, requiredSkills, assessmentModules } = req.body || {};
  if (!name || (!email && !phone)) return res.status(400).json({ error: "Name and at least one of email/phone are required" });
  if (!industry || !level) return res.status(400).json({ error: "Industry and level are required to build the right assessment" });

  const { ALL_MODULES } = require("../services/formTemplates");
  const cleanModules = Array.isArray(assessmentModules) && assessmentModules.length
    ? assessmentModules.filter((m) => ALL_MODULES.includes(m))
    : ALL_MODULES;

  const candidate = await db.insert("candidates", {
    tenantId,
    name: String(name).trim(),
    email: (email || "").trim().toLowerCase(),
    phone: (phone || "").trim(),
    industry,
    level,
    appliedRole: appliedRole || "",
    requiredSkills: require("../services/resumeService").splitSkills(requiredSkills),
    assessmentModules: cleanModules,
    caseType: caseType === "promotion" ? "promotion" : "screening",
    status: "created",
    formToken: crypto.randomBytes(16).toString("hex"),
    createdBy: req.user.id,
    createdByName: req.user.name,
    createdAt: new Date().toISOString(),
  });

  const label = candidate.caseType === "promotion" ? "promotion case" : "candidate";
  await activity.log({ tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "candidate.created", details: `Added ${label} ${candidate.name} (${industry} / ${level})` });
  await webhooks.dispatch("candidate.created", tenantId, { candidateId: candidate.id, name: candidate.name, caseType: candidate.caseType, industry, level });

  res.status(201).json({ candidate });
});

router.get("/:id", async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const candidate = await db.find("candidates", (c) => c.id === req.params.id && c.tenantId === tenantId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  const submission = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);
  const notifications = (await db.all("notifications", (n) => n.candidateId === candidate.id))
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  res.json({ candidate, submission, notifications, session });
});

// Send (or resend) the candidate's assessment / invite link over email / whatsapp / call / chatwoot.
router.post("/:id/send", async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const candidate = await db.find("candidates", (c) => c.id === req.params.id && c.tenantId === tenantId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const { channel } = req.body || {}; // 'email' | 'whatsapp' | 'call' | 'chatwoot'
  if (!["email", "whatsapp", "call", "chatwoot"].includes(channel)) {
    return res.status(400).json({ error: "channel must be 'email', 'whatsapp', 'call' or 'chatwoot'" });
  }

  const link = `${req.protocol}://${req.get("host")}/invite.html?token=${candidate.formToken}`;
  const noun = candidate.caseType === "promotion" ? "promotion review" : "screening";
  const message =
    channel === "call"
      ? `AI voice-call script: "Hello ${candidate.name}, this is Tech-Life AI HR calling regarding your ${candidate.appliedRole || candidate.level} ${noun}. We'll now begin a short screening conversation..."`
      : `Hi ${candidate.name}, please accept your invite for the ${candidate.appliedRole || candidate.level} ${noun} here: ${link}`;

  if (channel === "chatwoot") {
    if (!candidate.email && !candidate.phone) return res.status(400).json({ error: "This candidate has no email or phone on file" });
    try {
      const chatwoot = require("../services/chatwootService");
      const result = await chatwoot.sendMessage(candidate, message);
      const record = await db.insert("notifications", {
        tenantId, candidateId: candidate.id, channel: "chatwoot", target: `conversation #${result.conversationId}`,
        message, status: "sent", providerNote: `Chatwoot message ${result.messageId}`, sentBy: req.user.id, sentAt: new Date().toISOString(),
      });
      if (candidate.status === "created") await db.update("candidates", candidate.id, { status: "link_sent" });
      await activity.log({ tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "candidate.link_sent", details: `Sent Chatwoot message to ${candidate.name} (conversation #${result.conversationId})` });
      return res.status(201).json({ notification: record, link });
    } catch (e) {
      const record = await db.insert("notifications", {
        tenantId, candidateId: candidate.id, channel: "chatwoot", target: candidate.email || candidate.phone,
        message, status: "failed", providerNote: e.message, sentBy: req.user.id, sentAt: new Date().toISOString(),
      });
      return res.status(400).json({ error: e.message, notification: record });
    }
  }

  const featureKey = channel === "email" ? "email_notifications" : channel === "whatsapp" ? "whatsapp_notifications" : "telephony_calling";
  const flag = await db.find("tenantFeatures", (f) => f.tenantId === tenantId && f.key === featureKey);
  if (!flag || !flag.enabled) {
    return res.status(403).json({ error: `The ${channel} channel is not enabled for your organization. Ask your Superadmin to enable it.` });
  }
  if (channel === "email" && !candidate.email) return res.status(400).json({ error: "This candidate has no email on file" });
  if (channel !== "email" && !candidate.phone) return res.status(400).json({ error: "This candidate has no phone number on file" });

  const record = await notify.dispatch({ tenantId, candidate, channel, message, sentBy: req.user.id });
  if (candidate.status === "created") await db.update("candidates", candidate.id, { status: "link_sent" });
  await activity.log({ tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "candidate.link_sent", details: `Sent ${channel} to ${candidate.name}` });
  res.status(201).json({ notification: record, link });
});

module.exports = router;
