const express = require("express");
const db = require("../db");
const { requireAuth, requireRole, requireFeature, scopeTenantId } = require("../middleware/auth");
const promotionEngine = require("../services/promotionEngine");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"));

router.get("/:id/promotion-recommendation", requireFeature("kpi_analytics"), async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
  const candidate = await db.find("candidates", (c) => c.id === req.params.id && c.tenantId === tenantId);
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });

  const recommendation = await promotionEngine.computeRecommendation(candidate);
  res.json(recommendation);
});

module.exports = router;
