const express = require("express");
const db = require("../db");
const activity = require("../services/activityService");
const { buildFormTemplate } = require("../services/formTemplates");
const scheduling = require("../services/schedulingService");
const notify = require("../services/notifyService");

const router = express.Router();

async function candidateByToken(token) {
  return db.find("candidates", (c) => c.formToken === token);
}

// ---- Step 1: candidate opens the invite link ----
router.get("/invite/:token", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const tenant = await db.getById(candidate.tenantId);
  const tenantFeatures = await db.all("tenantFeatures", (f) => f.tenantId === candidate.tenantId);
  const pretestOn = !!tenantFeatures.find((f) => f.key === "pretest_forms" && f.enabled);
  const submission = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);

  res.json({
    tenantName: tenant ? tenant.name : "Organization",
    candidate: { name: candidate.name, appliedRole: candidate.appliedRole, status: candidate.status, caseType: candidate.caseType },
    pretestRequired: pretestOn && !submission,
    alreadyAccepted: candidate.status !== "created" && candidate.status !== "link_sent",
    session: session ? { status: session.status, mode: session.mode, roomId: session.roomId } : null,
  });
});

router.post("/invite/:token/accept", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });

  const tenantFeatures = await db.all("tenantFeatures", (f) => f.tenantId === candidate.tenantId);
  const pretestOn = !!tenantFeatures.find((f) => f.key === "pretest_forms" && f.enabled);
  const submission = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);

  if (candidate.status === "created" || candidate.status === "link_sent") {
    await db.update("candidates", candidate.id, { status: "invite_accepted" });
    await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "invite.accepted", details: `${candidate.name} accepted their invite` });
  }

  if (pretestOn && !submission) {
    return res.json({ next: "pretest" });
  }

  let session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) session = await scheduling.scheduleInterview(candidate);
  return res.json({ next: "interview", session: { roomId: session.roomId, mode: session.mode, status: session.status } });
});

// ---- Step 2 (optional): pre-test / smart form ----
router.get("/form/:token", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });

  const tenant = await db.getById(candidate.tenantId);
  const existing = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);
  const template = await buildFormTemplate(candidate.industry, candidate.level);

  res.json({
    tenantName: tenant ? tenant.name : "Organization",
    candidate: { name: candidate.name, appliedRole: candidate.appliedRole, status: candidate.status },
    template,
    alreadySubmitted: !!existing,
  });
});

router.post("/form/:token", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });

  const existing = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);
  if (existing) return res.status(409).json({ error: "This form has already been submitted" });

  const { profile, answers } = req.body || {};
  if (!profile || !answers) return res.status(400).json({ error: "profile and answers are required" });

  const submission = await db.insert("formSubmissions", {
    candidateId: candidate.id,
    tenantId: candidate.tenantId,
    profile,
    answers,
    submittedAt: new Date().toISOString(),
  });

  await db.update("candidates", candidate.id, { status: "form_submitted" });
  await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "form.submitted", details: `${candidate.name} submitted their screening form` });

  // Pre-test done -> move straight into interview scheduling (human or AI).
  const session = await scheduling.scheduleInterview({ ...candidate, status: "form_submitted" });

  res.status(201).json({ submission, session: { roomId: session.roomId, mode: session.mode, status: session.status } });
});

// ---- Step 3: the interview room itself (candidate side, token-authenticated) ----
router.get("/room/:token", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview has been scheduled yet" });
  const template = await buildFormTemplate(candidate.industry, candidate.level);

  res.json({
    candidateName: candidate.name,
    roomId: session.roomId,
    mode: session.mode,
    status: session.status,
    aiPaused: !!session.aiPaused,
    assignedUserName: session.assignedUserName,
    questions: template.questions,
  });
});

router.post("/room/:token/transcript", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview session found" });

  const { speaker, text } = req.body || {};
  if (!speaker || !text) return res.status(400).json({ error: "speaker and text are required" });

  const entry = await db.insert("interviewTranscripts", {
    tenantId: candidate.tenantId,
    sessionId: session.id,
    candidateId: candidate.id,
    speaker, // 'ai' | 'candidate' | 'hr'
    text,
    at: new Date().toISOString(),
  });
  res.status(201).json({ entry });
});

router.post("/room/:token/complete", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview session found" });

  await db.update("interviewSessions", session.id, { status: "completed", completedAt: new Date().toISOString() });
  await db.update("candidates", candidate.id, { status: "interview_completed" });
  await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "interview.completed", details: `Interview session completed for ${candidate.name}` });
  res.json({ ok: true });
});

module.exports = router;
