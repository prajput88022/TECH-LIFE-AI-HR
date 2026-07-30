// Decides, at the moment a candidate accepts their invite (or completes their
// pre-test), whether a human (HR/Management) conducts the interview or the
// AI conducts it end-to-end - including the call itself when telephony/voice
// features are enabled. Mirrors the "Human-in-the-loop" principle: AI only
// takes over when no human is available, and a human can always step in and
// take over a live AI-led session (see interview-room.js "Take over" control).

const crypto = require("crypto");
const db = require("../db");
const activity = require("../services/activityService");
const webhooks = require("../services/webhookService");

async function pickAvailableHuman(tenantId) {
  const users = await db.all("users", (u) => u.tenantId === tenantId && ["hr", "management"].includes(u.role) && u.status === "active");
  // Prefer someone who has explicitly marked themselves Available.
  const available = users.filter((u) => u.available !== false);
  return available[0] || null;
}

async function scheduleInterview(candidate) {
  const tenantFeatures = await db.all("tenantFeatures", (f) => f.tenantId === candidate.tenantId);
  const flag = (key) => !!tenantFeatures.find((f) => f.key === key && f.enabled);

  const human = await pickAvailableHuman(candidate.tenantId);
  let mode;
  if (human) {
    mode = "human";
  } else if (flag("ai_voice_interview")) {
    mode = "ai";
  } else {
    mode = "human_pending"; // no one available and AI interviewing isn't enabled - queued for a human later
  }

  const session = await db.insert("interviewSessions", {
    tenantId: candidate.tenantId,
    candidateId: candidate.id,
    mode,
    assignedUserId: human ? human.id : null,
    assignedUserName: human ? human.name : null,
    roomId: crypto.randomBytes(8).toString("hex"),
    status: mode === "human_pending" ? "queued" : "scheduled",
    aiPaused: false,
    scheduledAt: new Date().toISOString(),
  });

  await db.update("candidates", candidate.id, { status: "interview_scheduled" });
  await activity.log({
    tenantId: candidate.tenantId,
    userId: null,
    actorName: candidate.name,
    role: candidate.caseType === "promotion" ? "employee" : "candidate",
    action: "interview.scheduled",
    details: mode === "ai"
      ? `AI will conduct the interview for ${candidate.name} (no HR/Management currently available)`
      : mode === "human"
        ? `${human.name} assigned to interview ${candidate.name}`
        : `${candidate.name}'s interview is queued — no HR/Management available and AI interviewing is off`,
  });
  await webhooks.dispatch("interview.scheduled", candidate.tenantId, { candidateId: candidate.id, sessionId: session.id, mode, roomId: session.roomId });

  return session;
}

module.exports = { scheduleInterview, pickAvailableHuman };
