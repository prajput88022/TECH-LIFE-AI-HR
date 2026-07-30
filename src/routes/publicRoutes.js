const express = require("express");
const db = require("../db");
const activity = require("../services/activityService");
const { buildFormTemplate, scorePretestSubmission } = require("../services/formTemplates");
const scheduling = require("../services/schedulingService");
const notify = require("../services/notifyService");
const webhooks = require("../services/webhookService");
const scoring = require("../services/scoringService");
const callAnalysis = require("../services/callAnalysisService");
const mattermost = require("../services/mattermostService");
const { rateLimit } = require("../middleware/rateLimit");

const router = express.Router();

// Mirrors interviewRoutes.js ESCALATION_LEVELS - levels senior enough to need Management approval.
const ESCALATION_LEVEL_CHECK = ["gm", "vp"];

// Public routes have no login, so they're the platform's main abuse surface. Reads are
// allowed a bit more headroom than writes (form/consent/transcript submissions).
router.use(rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "public-read" }));
const writeLimiter = rateLimit({ windowMs: 60_000, max: 12, keyPrefix: "public-write" });

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
    autoScreenedOut: candidate.status === "auto_screened_out",
    session: session ? { status: session.status, mode: session.mode, roomId: session.roomId } : null,
  });
});

router.post("/invite/:token/accept", writeLimiter, async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  if (candidate.status === "auto_screened_out") return res.status(403).json({ error: "This application is not proceeding further at this time." });

  const tenantFeatures = await db.all("tenantFeatures", (f) => f.tenantId === candidate.tenantId);
  const pretestOn = !!tenantFeatures.find((f) => f.key === "pretest_forms" && f.enabled);
  const submission = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);

  if (candidate.status === "created" || candidate.status === "link_sent") {
    await db.update("candidates", candidate.id, { status: "invite_accepted" });
    await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "invite.accepted", details: `${candidate.name} accepted their invite` });
    await webhooks.dispatch("invite.accepted", candidate.tenantId, { candidateId: candidate.id, name: candidate.name });
  }

  if (pretestOn && !submission) {
    return res.json({ next: "pretest" });
  }

  let session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) session = await scheduling.scheduleInterview(candidate);
  return res.json({ next: "interview", session: { roomId: session.roomId, mode: session.mode, status: session.status } });
});

// ---- Step 2 (optional): pre-test / smart form, built only from the modules HR assigned ----
router.get("/form/:token", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });

  const tenant = await db.getById(candidate.tenantId);
  const existing = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);
  const template = await buildFormTemplate(candidate.industry, candidate.level, candidate.assessmentModules);

  res.json({
    tenantName: tenant ? tenant.name : "Organization",
    candidate: { name: candidate.name, appliedRole: candidate.appliedRole, status: candidate.status },
    template,
    alreadySubmitted: !!existing,
  });
});

router.post("/form/:token", writeLimiter, async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });

  const existing = await db.find("formSubmissions", (s) => s.candidateId === candidate.id);
  if (existing) return res.status(409).json({ error: "This form has already been submitted" });

  const { profile, answers } = req.body || {};
  if (!profile || !answers) return res.status(400).json({ error: "profile and answers are required" });

  const scored = scorePretestSubmission(answers, candidate.assessmentModules);

  const submission = await db.insert("formSubmissions", {
    candidateId: candidate.id,
    tenantId: candidate.tenantId,
    profile,
    answers,
    scored,
    submittedAt: new Date().toISOString(),
  });

  const patch = { status: "form_submitted" };
  if (typeof scored.overallPretestScore === "number") patch.pretestScore = candidate.pretestScore ?? scored.overallPretestScore;
  if (typeof scored.aptitudeScore === "number") patch.aptitudeScore = scored.aptitudeScore;
  if (typeof scored.communicationScore === "number") patch.communicationScore = scored.communicationScore;
  if (scored.personalityProfile) patch.personalityProfile = scored.personalityProfile;

  await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "form.submitted", details: `${candidate.name} submitted their screening form (overall pre-test ${scored.overallPretestScore ?? "n/a"})` });
  await webhooks.dispatch("pretest.submitted", candidate.tenantId, { candidateId: candidate.id, name: candidate.name, scored });

  // ---- Pass-threshold auto-screening ----
  const threshold = await scoring.getPretestThreshold(candidate.tenantId);
  if (threshold.enabled && typeof scored.overallPretestScore === "number" && scored.overallPretestScore < threshold.minScore) {
    patch.status = "auto_screened_out";
    await db.update("candidates", candidate.id, patch);
    await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "system", action: "candidate.auto_screened_out", details: `${candidate.name} auto-screened out — pre-test score ${scored.overallPretestScore} below threshold ${threshold.minScore}` });
    await webhooks.dispatch("candidate.auto_screened_out", candidate.tenantId, { candidateId: candidate.id, score: scored.overallPretestScore, threshold: threshold.minScore });
    return res.status(201).json({ submission, autoScreenedOut: true, session: null });
  }

  await db.update("candidates", candidate.id, patch);

  // Pre-test done and passed (or no threshold configured) -> move into interview scheduling.
  const session = await scheduling.scheduleInterview({ ...candidate, status: "form_submitted" });

  res.status(201).json({ submission, session: { roomId: session.roomId, mode: session.mode, status: session.status } });
});

// ---- Step 3: the interview room itself (candidate side, token-authenticated) ----
router.get("/room/:token", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview has been scheduled yet" });
  const template = await buildFormTemplate(candidate.industry, candidate.level, candidate.assessmentModules);

  res.json({
    candidateName: candidate.name,
    roomId: session.roomId,
    mode: session.mode,
    status: session.status,
    aiPaused: !!session.aiPaused,
    assignedUserName: session.assignedUserName,
    consentGiven: !!session.consentGiven,
    externalMeetingLink: mattermost.getMeetingLink(),
    questions: template.questions,
  });
});

// Candidate must explicitly consent to being recorded/transcribed before the room is usable.
router.post("/room/:token/consent", writeLimiter, async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview session found" });

  const updated = await db.update("interviewSessions", session.id, { consentGiven: true, consentAt: new Date().toISOString() });
  await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "consent.given", details: `${candidate.name} consented to interview recording/transcription` });
  res.json({ ok: true, session: updated });
});

router.post("/room/:token/transcript", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview session found" });
  if (!session.consentGiven) return res.status(403).json({ error: "Consent is required before the interview can proceed" });

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

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// Candidate-side upload of their local WebRTC call recording (mixed local+remote audio/video).
router.post("/room/:token/recording", upload.single("recording"), async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview session found" });
  if (!req.file) return res.status(400).json({ error: "No recording uploaded (field name must be 'recording')" });

  try {
    await db.putAttachment(session.id, "recording-candidate", req.file.buffer, req.file.mimetype || "video/webm");
    await db.update("interviewSessions", session.id, { recordingCandidateUploadedAt: new Date().toISOString(), recordingMimeType: req.file.mimetype });
    await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "recording.uploaded", details: `Call recording saved for ${candidate.name}'s session (candidate side, ${(req.file.size / 1024 / 1024).toFixed(1)}MB)` });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not save the recording: " + e.message });
  }
});

router.post("/room/:token/complete", async (req, res) => {
  const candidate = await candidateByToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: "This link is invalid or has expired" });
  const session = await db.find("interviewSessions", (s) => s.candidateId === candidate.id);
  if (!session) return res.status(404).json({ error: "No interview session found" });

  const transcript = (await db.all("interviewTranscripts", (t) => t.sessionId === session.id)).sort((a, b) => new Date(a.at) - new Date(b.at));
  const analysis = callAnalysis.analyzeTranscript(transcript);

  await db.update("interviewSessions", session.id, { status: "completed", completedAt: new Date().toISOString(), callAnalysis: analysis });
  await db.update("candidates", candidate.id, { status: "interview_completed" });
  await activity.log({ tenantId: candidate.tenantId, userId: null, actorName: candidate.name, role: "candidate", action: "interview.completed", details: `Interview session completed for ${candidate.name}${analysis.available ? ` (sentiment: ${analysis.overallSentiment.label}${analysis.angerDetected ? ", anger flagged" : ""})` : ""}` });
  await webhooks.dispatch("interview.completed", candidate.tenantId, { candidateId: candidate.id, sessionId: session.id, mode: session.mode, analysis });

  if (analysis.available && analysis.angerDetected) {
    mattermost.sendNotification(
      `⚠️ **Anger detected** on a call — candidate **${candidate.name}** (${candidate.appliedRole || candidate.level}). ` +
      `Sentiment: ${analysis.overallSentiment.label}. Please review the transcript before finalizing a decision.`
    ).catch(() => { /* Mattermost not configured or unreachable - non-fatal */ });
  }
  if (ESCALATION_LEVEL_CHECK.includes(candidate.level)) {
    mattermost.sendNotification(
      `📋 **${candidate.name}**'s ${candidate.caseType === "promotion" ? "promotion review" : "application"} (${candidate.level.toUpperCase()}) is ready for review — this level requires Management approval.`
    ).catch(() => { /* non-fatal */ });
  }
  res.json({ ok: true, analysis });
});

module.exports = router;
