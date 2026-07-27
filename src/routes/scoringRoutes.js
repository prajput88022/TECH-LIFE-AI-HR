const express = require("express");
const { requireAuth, requireRole, requireFeature, scopeTenantId } = require("../middleware/auth");
const activity = require("../services/activityService");
const scoring = require("../services/scoringService");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"), requireFeature("kpi_analytics"));

router.get("/weights", async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
  res.json({ weights: await scoring.getWeights(tenantId) });
});

router.put("/weights", async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
  const { kpi, interview, pretest } = req.body || {};
  if ([kpi, interview, pretest].some((v) => v === undefined)) {
    return res.status(400).json({ error: "kpi, interview and pretest weights are all required (they don't need to sum to 100 - they're normalized automatically)" });
  }
  const weights = await scoring.setWeights(tenantId, { kpi, interview, pretest });
  await activity.log({ tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "scoring.weights_updated", details: `Weights set to KPI ${kpi} / Interview ${interview} / Pretest ${pretest}` });
  res.json({ weights });
});

module.exports = router;
