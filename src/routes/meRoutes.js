const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { FEATURE_CATALOG } = require("../featureCatalog");
const activity = require("../services/activityService");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const user = req.user;
  let tenant = null;
  let features = [];

  if (user.tenantId) {
    tenant = await db.getById(user.tenantId);
    const flags = await db.all("tenantFeatures", (f) => f.tenantId === user.tenantId);
    features = FEATURE_CATALOG.map((f) => ({ key: f.key, label: f.label, enabled: !!flags.find((x) => x.key === f.key)?.enabled }));
  }

  const { passwordHash, mfaSecret, mfaPendingSecret, ...safeUser } = user;
  res.json({ user: safeUser, tenant, features });
});

// HR / Management mark themselves available or busy - drives human-vs-AI interview routing.
router.patch("/availability", async (req, res) => {
  if (!["hr", "management"].includes(req.user.role)) return res.status(403).json({ error: "Only HR/Management can set availability" });
  const { available } = req.body || {};
  const updated = await db.update("users", req.user.id, { available: !!available });
  await activity.log({ tenantId: req.user.tenantId, userId: req.user.id, actorName: req.user.name, role: req.user.role, action: "availability.changed", details: `${req.user.name} set availability to ${available ? "Available" : "Busy"}` });
  const { passwordHash, mfaSecret, mfaPendingSecret, ...safeUser } = updated;
  res.json({ user: safeUser });
});

module.exports = router;
