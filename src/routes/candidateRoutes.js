const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { requireAuth, requireRole, requireFeature, scopeTenantId } = require("../middleware/auth");
const activity = require("../services/activityService");
const notify = require("../services/notifyService");

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

  const { name, email, phone, industry, level, appliedRole, caseType } = req.body || {};
  if (!name || (!email && !phone)) return res.status(400).json({ error: "Name and at least one of email/phone are required" });
  if (!industry || !level) return res.status(400).json({ error: "Industry and level are required to build the right assessment" });

  const candidate = await db.insert("candidates", {
    tenantId,
    name: String(name).trim(),
    email: (email || "").trim().toLowerCase(),
    phone: (phone || "").trim(),
    industry,
    level,
    appliedRole: appliedRole || "",
    caseType: caseType === "promotion" ? "promotion" : "screening",
    status: "created",
    formToken: crypto.randomBytes(16).toString("hex"),
    createdBy: req.user.id,
    createdByName: req.user.name,
    createdAt: new Date().toISOString(),
  });

  const label = candidate.caseType === "promotion" ? "promotion case" : "candidate";
  await activity.log({ tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "candidate.created", details: `Added ${label} ${candidate.name} (${industry} / ${level})` });

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

// Send (or resend) the candidate's assessment / invite link over email / whatsapp / call.
router.post("/:id/send", async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const candidate = await db.find("candidates", (c) => c.id === req.params.id && c.tenantId === tenantId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const { channel } = req.body || {}; // 'email' | 'whatsapp' | 'call'
  if (!["email", "whatsapp", "call"].includes(channel)) {
    return res.status(400).json({ error: "channel must be 'email', 'whatsapp' or 'call'" });
  }
  const featureKey = channel === "email" ? "email_notifications" : channel === "whatsapp" ? "whatsapp_notifications" : "telephony_calling";
  const flag = await db.find("tenantFeatures", (f) => f.tenantId === tenantId && f.key === featureKey);
  if (!flag || !flag.enabled) {
    return res.status(403).json({ error: `The ${channel} channel is not enabled for your organization. Ask your Superadmin to enable it.` });
  }
  if (channel === "email" && !candidate.email) return res.status(400).json({ error: "This candidate has no email on file" });
  if (channel !== "email" && !candidate.phone) return res.status(400).json({ error: "This candidate has no phone number on file" });

  const link = `${req.protocol}://${req.get("host")}/invite.html?token=${candidate.formToken}`;
  const noun = candidate.caseType === "promotion" ? "promotion review" : "screening";
  const message =
    channel === "call"
      ? `AI voice-call script: "Hello ${candidate.name}, this is Tech-Life AI HR calling regarding your ${candidate.appliedRole || candidate.level} ${noun}. We'll now begin a short screening conversation..."`
      : `Hi ${candidate.name}, please accept your invite for the ${candidate.appliedRole || candidate.level} ${noun} here: ${link}`;

  const record = await notify.dispatch({ tenantId, candidate, channel, message, sentBy: req.user.id });
  if (candidate.status === "created") await db.update("candidates", candidate.id, { status: "link_sent" });
  await activity.log({ tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "candidate.link_sent", details: `Sent ${channel} to ${candidate.name}` });
  res.status(201).json({ notification: record, link });
});

module.exports = router;
