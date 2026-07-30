const express = require("express");
const db = require("../db");
const { requireAuth, requireRole, requireFeature, scopeTenantId } = require("../middleware/auth");
const scoring = require("../services/scoringService");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"));

const ESCALATION_LEVELS = ["gm", "vp"];

// ---- Candidate comparison + department analytics + attrition risk (legacy, still used by dashboard) ----
router.get("/scorecards", requireFeature("reports_dashboard"), async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const candidates = await db.all("candidates", (c) => c.tenantId === tenantId);
  const kpiOn = !!(await db.find("tenantFeatures", (f) => f.tenantId === tenantId && f.key === "kpi_analytics" && f.enabled));

  const scorecards = [];
  for (const c of candidates) {
    let readiness = null;
    let attritionRisk = false;
    if (kpiOn) {
      readiness = await scoring.computeReadinessScore(c);
      attritionRisk = c.caseType === "promotion" && readiness.kpi.trend === "declining";
    }
    scorecards.push({
      id: c.id, name: c.name, industry: c.industry, level: c.level, caseType: c.caseType, status: c.status,
      readinessScore: readiness ? readiness.finalScore : null,
      kpiTrend: readiness ? readiness.kpi.trend : null,
      interviewScore: c.interviewScore ?? null,
      pretestScore: c.pretestScore ?? null,
      attritionRisk,
    });
  }
  scorecards.sort((a, b) => (b.readinessScore ?? -1) - (a.readinessScore ?? -1));

  const byIndustry = {};
  candidates.forEach((c) => { byIndustry[c.industry] = byIndustry[c.industry] || { count: 0, scores: [] }; byIndustry[c.industry].count += 1; });
  scorecards.forEach((s) => { if (s.readinessScore !== null) byIndustry[s.industry].scores.push(s.readinessScore); });
  const departmentAnalytics = Object.entries(byIndustry).map(([industry, d]) => ({
    industry, count: d.count,
    avgReadinessScore: d.scores.length ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : null,
  }));

  res.json({ scorecards, departmentAnalytics, attritionRiskCount: scorecards.filter((s) => s.attritionRisk).length });
});

// ---- The Management Reports Page: one rich, filterable, searchable case list ----
router.get("/cases", requireFeature("reports_dashboard"), async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const { dateFrom, dateTo, industry, level, caseType, status, decision, interviewMode, search, sentiment, angerOnly } = req.query;

  let candidates = await db.all("candidates", (c) => c.tenantId === tenantId);
  const sessions = await db.all("interviewSessions", (s) => s.tenantId === tenantId);
  const notifications = await db.all("notifications", (n) => n.tenantId === tenantId);
  const kpiOn = !!(await db.find("tenantFeatures", (f) => f.tenantId === tenantId && f.key === "kpi_analytics" && f.enabled));

  // ---- Filters ----
  if (dateFrom) candidates = candidates.filter((c) => new Date(c.createdAt) >= new Date(dateFrom));
  if (dateTo) candidates = candidates.filter((c) => new Date(c.createdAt) <= new Date(dateTo + "T23:59:59"));
  if (industry) candidates = candidates.filter((c) => c.industry === industry);
  if (level) candidates = candidates.filter((c) => c.level === level);
  if (caseType) candidates = candidates.filter((c) => c.caseType === caseType);
  if (status) candidates = candidates.filter((c) => c.status === status);
  if (search) {
    const q = search.toLowerCase();
    candidates = candidates.filter((c) => c.name.toLowerCase().includes(q) || (c.appliedRole || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q));
  }

  const rows = [];
  for (const c of candidates) {
    const session = sessions.find((s) => s.candidateId === c.id);
    if (interviewMode && (!session || session.mode !== interviewMode)) continue;
    if (decision && (!session || session.decision !== decision)) continue;
    if (sentiment && (!session || !session.callAnalysis || session.callAnalysis.overallSentiment?.label !== sentiment)) continue;
    if (angerOnly === "true" && (!session || !session.callAnalysis || !session.callAnalysis.angerDetected)) continue;

    let readiness = null;
    if (kpiOn) readiness = await scoring.computeReadinessScore(c);

    const emailsSent = notifications.filter((n) => n.candidateId === c.id && n.channel === "email").length;
    const whatsappSent = notifications.filter((n) => n.candidateId === c.id && n.channel === "whatsapp").length;
    const callsSent = notifications.filter((n) => n.candidateId === c.id && n.channel === "call").length;

    rows.push({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      appliedRole: c.appliedRole,
      industry: c.industry,
      level: c.level,
      caseType: c.caseType,
      status: c.status,
      createdAt: c.createdAt,
      requiresEscalation: ESCALATION_LEVELS.includes(c.level),
      session: session ? {
        id: session.id, mode: session.mode, status: session.status, decision: session.decision || null,
        decisionBy: session.decisionBy || null, decisionByRole: session.decisionByRole || null, decisionAt: session.decisionAt || null,
        hasRecording: !!(session.recordingHrUploadedAt || session.recordingCandidateUploadedAt),
        callAnalysis: session.callAnalysis ? {
          sentiment: session.callAnalysis.overallSentiment,
          angerDetected: session.callAnalysis.angerDetected,
          qualityScore: session.callAnalysis.qualityScore,
          engagementScore: session.callAnalysis.engagementScore,
        } : null,
      } : null,
      readinessScore: readiness ? readiness.finalScore : null,
      kpiTrend: readiness ? readiness.kpi.trend : null,
      interviewScore: c.interviewScore ?? null,
      pretestScore: c.pretestScore ?? null,
      aptitudeScore: c.aptitudeScore ?? null,
      communicationScore: c.communicationScore ?? null,
      skillMatchScore: c.skillMatch ? c.skillMatch.score : null,
      notifications: { email: emailsSent, whatsapp: whatsappSent, call: callsSent },
    });
  }

  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({
    rows,
    total: rows.length,
    filtersApplied: { dateFrom, dateTo, industry, level, caseType, status, decision, interviewMode, search, sentiment, angerOnly },
  });
});

// ---- Pending approvals — cases whose interview is done but no decision has been recorded ----
router.get("/pending-approvals", requireFeature("reports_dashboard"), async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const candidates = await db.all("candidates", (c) => c.tenantId === tenantId);
  const sessions = await db.all("interviewSessions", (s) => s.tenantId === tenantId);

  const pending = sessions
    .filter((s) => s.status === "completed" && !s.decision)
    .map((s) => {
      const candidate = candidates.find((c) => c.id === s.candidateId);
      if (!candidate) return null;
      return {
        sessionId: s.id,
        candidateId: candidate.id,
        name: candidate.name,
        level: candidate.level,
        industry: candidate.industry,
        caseType: candidate.caseType,
        mode: s.mode,
        completedAt: s.completedAt,
        requiresManagementApproval: ESCALATION_LEVELS.includes(candidate.level),
        sentiment: s.callAnalysis ? s.callAnalysis.overallSentiment.label : null,
        angerDetected: s.callAnalysis ? s.callAnalysis.angerDetected : false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));

  res.json({ pending, count: pending.length });
});

// ---- Webhook delivery log (audit visibility into outbound integrations) ----
router.get("/webhook-deliveries", async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  const deliveries = (await db.all("webhookDeliveries", (d) => !tenantId || d.tenantId === tenantId))
    .sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt))
    .slice(0, 200);
  res.json({ deliveries });
});

// ---- Compliance / audit export ----
router.get("/compliance-export", async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });

  const { dateFrom, dateTo, industry, level, caseType, status, decision, interviewMode, search } = req.query;
  let candidates = await db.all("candidates", (c) => c.tenantId === tenantId);
  const sessions = await db.all("interviewSessions", (s) => s.tenantId === tenantId);
  const notifications = await db.all("notifications", (n) => n.tenantId === tenantId);

  if (dateFrom) candidates = candidates.filter((c) => new Date(c.createdAt) >= new Date(dateFrom));
  if (dateTo) candidates = candidates.filter((c) => new Date(c.createdAt) <= new Date(dateTo + "T23:59:59"));
  if (industry) candidates = candidates.filter((c) => c.industry === industry);
  if (level) candidates = candidates.filter((c) => c.level === level);
  if (caseType) candidates = candidates.filter((c) => c.caseType === caseType);
  if (status) candidates = candidates.filter((c) => c.status === status);
  if (search) {
    const q = search.toLowerCase();
    candidates = candidates.filter((c) => c.name.toLowerCase().includes(q) || (c.appliedRole || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q));
  }

  let rows = candidates.map((c) => {
    const session = sessions.find((s) => s.candidateId === c.id);
    const emailsSent = notifications.filter((n) => n.candidateId === c.id && n.channel === "email").length;
    return {
      candidateId: c.id, name: c.name, caseType: c.caseType, industry: c.industry, level: c.level, status: c.status,
      interviewMode: session ? session.mode : null,
      decision: session ? session.decision || null : null,
      decisionBy: session ? session.decisionBy || null : null,
      decisionAt: session ? session.decisionAt || null : null,
      decisionNotes: c.decisionNotes || "",
      notificationsSent: emailsSent,
      createdAt: c.createdAt,
    };
  });

  if (interviewMode) rows = rows.filter((r) => r.interviewMode === interviewMode);
  if (decision) rows = rows.filter((r) => r.decision === decision);

  if (req.query.format === "csv") {
    const headers = Object.keys(rows[0] || { candidateId: "", name: "" });
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=compliance-export.csv");
    return res.send(csv);
  }

  res.json({ rows });
});

module.exports = router;
