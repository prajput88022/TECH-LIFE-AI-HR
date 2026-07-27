const express = require("express");
const db = require("../db");
const { requireAuth, requireRole, requireFeature, scopeTenantId } = require("../middleware/auth");
const activity = require("../services/activityService");
const scoring = require("../services/scoringService");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"));

function tenantOf(req) {
  const id = scopeTenantId(req);
  if (!id) throw Object.assign(new Error("tenantId is required"), { status: 400 });
  return id;
}

async function loadCandidate(req, res) {
  const tenantId = tenantOf(req);
  const candidate = await db.find("candidates", (c) => c.id === req.params.id && c.tenantId === tenantId);
  if (!candidate) { res.status(404).json({ error: "Candidate/employee not found" }); return null; }
  return candidate;
}

// ---- Import one KPI review-period record ----
router.post("/:id/kpi", requireFeature("kpi_analytics"), async (req, res) => {
  let candidate;
  try { candidate = await loadCandidate(req, res); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!candidate) return;

  const { period, metrics } = req.body || {};
  if (!period || !Array.isArray(metrics) || !metrics.length) {
    return res.status(400).json({ error: "period (e.g. 'Q1 2026') and a non-empty metrics array are required" });
  }
  const cleanMetrics = metrics.map((m) => ({
    name: String(m.name || "").trim(),
    value: Number(m.value),
    target: Number(m.target) || 0,
    direction: m.direction === "lower_is_better" ? "lower_is_better" : "higher_is_better",
  })).filter((m) => m.name && !Number.isNaN(m.value));
  if (!cleanMetrics.length) return res.status(400).json({ error: "Each metric needs a name and a numeric value" });

  const record = await db.insert("kpiRecords", {
    tenantId: candidate.tenantId,
    candidateId: candidate.id,
    period: String(period).trim(),
    metrics: cleanMetrics,
    importedBy: req.user.id,
    importedByName: req.user.name,
    importedAt: new Date().toISOString(),
  });

  await activity.log({ tenantId: candidate.tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "kpi.imported", details: `Imported KPI record for ${candidate.name} (${period})` });

  res.status(201).json({ record });
});

// ---- List KPI history + trend for a candidate/employee ----
router.get("/:id/kpi", requireFeature("kpi_analytics"), async (req, res) => {
  let candidate;
  try { candidate = await loadCandidate(req, res); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!candidate) return;

  const records = (await db.all("kpiRecords", (r) => r.candidateId === candidate.id))
    .sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  const trend = scoring.computeKpiScore(records);
  res.json({ records, trend });
});

router.delete("/:id/kpi/:recordId", requireFeature("kpi_analytics"), async (req, res) => {
  let candidate;
  try { candidate = await loadCandidate(req, res); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!candidate) return;
  const ok = await db.remove(req.params.recordId);
  if (!ok) return res.status(404).json({ error: "KPI record not found" });
  res.json({ ok: true });
});

// ---- Manually set interview/pretest scores (0-100) feeding into the readiness score ----
router.patch("/:id/scores", requireFeature("kpi_analytics"), async (req, res) => {
  let candidate;
  try { candidate = await loadCandidate(req, res); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!candidate) return;

  const patch = {};
  if (req.body.interviewScore !== undefined && req.body.interviewScore !== null && req.body.interviewScore !== "") {
    const v = Number(req.body.interviewScore);
    if (Number.isNaN(v) || v < 0 || v > 100) return res.status(400).json({ error: "interviewScore must be a number 0-100" });
    patch.interviewScore = v;
  }
  if (req.body.pretestScore !== undefined && req.body.pretestScore !== null && req.body.pretestScore !== "") {
    const v = Number(req.body.pretestScore);
    if (Number.isNaN(v) || v < 0 || v > 100) return res.status(400).json({ error: "pretestScore must be a number 0-100" });
    patch.pretestScore = v;
  }
  const updated = await db.update("candidates", candidate.id, patch);
  res.json({ candidate: updated });
});

// ---- Computed promotion/hiring readiness score (KPI + interview + pretest, weighted) ----
router.get("/:id/readiness-score", requireFeature("kpi_analytics"), async (req, res) => {
  let candidate;
  try { candidate = await loadCandidate(req, res); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (!candidate) return;
  const result = await scoring.computeReadinessScore(candidate);
  res.json(result);
});

module.exports = router;
