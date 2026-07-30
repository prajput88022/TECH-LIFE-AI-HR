const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const mfa = require("../services/mfaService");
const activity = require("../services/activityService");

const router = express.Router();
router.use(requireAuth);

// Step 1: generate a new secret + QR code (not yet enabled until confirmed with a valid code).
router.post("/setup", async (req, res) => {
  const secret = mfa.generateSecret();
  const uri = mfa.keyUri(req.user.email, secret);
  const qrDataUrl = await mfa.generateQrDataUrl(uri);
  await db.update("users", req.user.id, { mfaPendingSecret: secret });
  res.json({ secret, otpauthUri: uri, qrDataUrl });
});

// Step 2: confirm setup by entering a code from the authenticator app.
router.post("/confirm", async (req, res) => {
  const { token } = req.body || {};
  const user = await db.getById(req.user.id);
  if (!user.mfaPendingSecret) return res.status(400).json({ error: "No MFA setup in progress - call /setup first" });
  if (!mfa.verifyToken(token, user.mfaPendingSecret)) return res.status(400).json({ error: "Incorrect code - please try again" });

  await db.update("users", user.id, { mfaEnabled: true, mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null });
  await activity.log({ tenantId: user.tenantId, userId: user.id, actorName: user.name, role: user.role, action: "mfa.enabled", details: `${user.name} enabled two-factor authentication` });
  res.json({ ok: true });
});

router.post("/disable", async (req, res) => {
  const { token } = req.body || {};
  const user = await db.getById(req.user.id);
  if (!user.mfaEnabled) return res.status(400).json({ error: "MFA is not currently enabled" });
  if (!mfa.verifyToken(token, user.mfaSecret)) return res.status(400).json({ error: "Incorrect code" });

  await db.update("users", user.id, { mfaEnabled: false, mfaSecret: null });
  await activity.log({ tenantId: user.tenantId, userId: user.id, actorName: user.name, role: user.role, action: "mfa.disabled", details: `${user.name} disabled two-factor authentication` });
  res.json({ ok: true });
});

router.get("/status", async (req, res) => {
  res.json({ mfaEnabled: !!req.user.mfaEnabled });
});

module.exports = router;
