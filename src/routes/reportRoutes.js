const express = require("express");
const db = require("../db");
const { requireAuth, requireRole, requireFeature, scopeTenantId } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("hr", "management", "superadmin"), requireFeature("reports_dashboard"));

router.get("/activity", async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
  const logs = (await db.all("activityLogs", (l) => l.tenantId === tenantId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ logs });
});

router.get("/pipeline", async (req, res) => {
  const tenantId = scopeTenantId(req) || req.user.tenantId;
  if (!tenantId) return res.status(400).json({ error: "tenantId is required" });
  const candidates = await db.all("candidates", (c) => c.tenantId === tenantId);
  const notifications = await db.all("notifications", (n) => n.tenantId === tenantId);
  const submissions = await db.all("formSubmissions", (s) => s.tenantId === tenantId);
  const sessions = await db.all("interviewSessions", (s) => s.tenantId === tenantId);

  const byStatus = candidates.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});
  const byChannel = notifications.reduce((acc, n) => { acc[n.channel] = (acc[n.channel] || 0) + 1; return acc; }, {});
  const byMode = sessions.reduce((acc, s) => { acc[s.mode] = (acc[s.mode] || 0) + 1; return acc; }, {});

  res.json({
    totalCandidates: candidates.length,
    byStatus,
    notificationsSent: notifications.length,
    byChannel,
    formsSubmitted: submissions.length,
    conversionRate: candidates.length ? Math.round((submissions.length / candidates.length) * 100) : 0,
    interviewsByMode: byMode,
  });
});

module.exports = router;
