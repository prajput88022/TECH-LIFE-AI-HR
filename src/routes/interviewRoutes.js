const express = require("express");
const db = require("../db");
const { requireAuth, requireRole, scopeTenantId } = require("../middleware/auth");
const activity = require("../services/activityService");
const notify = require("../services/notifyService");
const scoring = require("../services/scoringService");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"));

function tenantOf(req) {
  const id = scopeTenantId(req);
  if (!id) throw Object.assign(new Error("tenantId is required"), { status: 400 });
  return id;
}

router.get("/", async (req, res) => {
  let tenantId;
  try { tenantId = tenantOf(req); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const sessions = (await db.all("interviewSessions", (s) => s.tenantId === tenantId))
    .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
  const candidates = await db.all("candidates", (c) => c.tenantId === tenantId);
  const enriched = sessions.map((s) => ({ ...s, candidate: candidates.find((c) => c.id === s.candidateId) }));
  res.json({ sessions: enriched });
});

router.get("/:id", async (req, res) => {
  const session = await db.getById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const candidate = await db.getById(session.candidateId);
  const transcript = (await db.all("interviewTranscripts", (t) => t.sessionId === session.id))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  res.json({ session, candidate, transcript });
});

// HR joins an AI-led (or queued) session and takes the wheel, or hands it back to AI.
router.post("/:id/takeover", async (req, res) => {
  const { action } = req.body || {}; // 'takeover' | 'resume_ai'
  const session = await db.getById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const patch = action === "takeover"
    ? { mode: "human", aiPaused: true, assignedUserId: req.user.id, assignedUserName: req.user.name, status: "in_progress" }
    : { aiPaused: false };
  const updated = await db.update("interviewSessions", session.id, patch);

  await activity.log({ tenantId: session.tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "interview.takeover", details: `${req.user.name} ${action === "takeover" ? "took over from AI" : "handed control back to AI"} for session ${session.id}` });
  res.json({ session: updated });
});

router.post("/:id/join", async (req, res) => {
  const session = await db.getById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const updated = await db.update("interviewSessions", session.id, { status: "in_progress", assignedUserId: req.user.id, assignedUserName: req.user.name });
  await activity.log({ tenantId: session.tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "interview.joined", details: `${req.user.name} joined session ${session.id}` });
  res.json({ session: updated });
});

// HR-side transcript entries (their own spoken turns when they've taken over).
router.post("/:id/transcript", async (req, res) => {
  const session = await db.getById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  const entry = await db.insert("interviewTranscripts", {
    tenantId: session.tenantId,
    sessionId: session.id,
    candidateId: session.candidateId,
    speaker: "hr",
    speakerName: req.user.name,
    text,
    at: new Date().toISOString(),
  });
  res.status(201).json({ entry });
});

// Final screening / promotion decision. Optionally emails the candidate/employee the result.
router.post("/:id/decision", async (req, res) => {
  const { decision, notes, notifyCandidate, interviewScore } = req.body || {};
  if (!["selected", "rejected", "hold"].includes(decision)) return res.status(400).json({ error: "decision must be 'selected', 'rejected' or 'hold'" });

  const session = await db.getById(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  let candidate = await db.getById(session.candidateId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const patch = { status: { selected: "selected", rejected: "rejected", hold: "on_hold" }[decision], decisionNotes: notes || "" };
  if (interviewScore !== undefined && interviewScore !== null && interviewScore !== "") {
    const v = Number(interviewScore);
    if (!Number.isNaN(v) && v >= 0 && v <= 100) patch.interviewScore = v;
  }
  candidate = await db.update("candidates", candidate.id, patch);
  await db.update("interviewSessions", session.id, { decision, decisionAt: new Date().toISOString(), decisionBy: req.user.name });

  const noun = candidate.caseType === "promotion" ? "promotion" : "application";
  await activity.log({ tenantId: candidate.tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "decision.finalized", details: `${req.user.name} marked ${candidate.name}'s ${noun} as "${decision}"` });

  let emailResult = null;
  if (notifyCandidate && candidate.email) {
    const flag = await db.find("tenantFeatures", (f) => f.tenantId === candidate.tenantId && f.key === "email_notifications");
    if (flag && flag.enabled) {
      const resultText = decision === "selected"
        ? `Congratulations ${candidate.name}! You have been selected for the ${candidate.appliedRole || candidate.level} ${noun}.`
        : decision === "rejected"
          ? `Hi ${candidate.name}, after careful review we will not be proceeding with your ${noun} at this time. Thank you for your time.`
          : `Hi ${candidate.name}, your ${noun} is currently on hold — we'll follow up with next steps soon.`;
      emailResult = await notify.dispatch({ tenantId: candidate.tenantId, candidate, channel: "email", message: resultText, sentBy: req.user.id });
    }
  }

  let readiness = null;
  const kpiFlag = await db.find("tenantFeatures", (f) => f.tenantId === candidate.tenantId && f.key === "kpi_analytics");
  if (kpiFlag && kpiFlag.enabled) readiness = await scoring.computeReadinessScore(candidate);

  res.json({ ok: true, emailResult, readiness });
});

module.exports = router;
