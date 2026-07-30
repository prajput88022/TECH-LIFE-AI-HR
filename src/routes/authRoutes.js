const express = require("express");
const db = require("../db");
const { verifyPassword, signToken, signMfaChallenge, verifyMfaChallenge } = require("../services/authService");
const mfa = require("../services/mfaService");
const activity = require("../services/activityService");

const router = express.Router();

// Superadmin login - platform-wide, no tenant code needed.
router.post("/login/superadmin", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  const user = await db.find("users", (u) => u.role === "superadmin" && u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (user.status !== "active") return res.status(403).json({ error: "This account has been deactivated" });

  if (user.mfaEnabled) {
    return res.json({ mfaRequired: true, mfaChallengeToken: signMfaChallenge(user) });
  }

  const token = signToken(user);
  await activity.log({ tenantId: null, userId: user.id, actorName: user.name, role: user.role, action: "login", details: "Superadmin logged in" });
  res.json({ token, user: publicUser(user) });
});

// Tenant-scoped user login (HR / Management) - requires the tenant code so the same
// email could theoretically exist under different tenants without collision.
router.post("/login/tenant", async (req, res) => {
  const { tenantCode, email, password } = req.body || {};
  if (!tenantCode || !email || !password) {
    return res.status(400).json({ error: "Organization code, email and password are required" });
  }

  const tenant = await db.find("tenants", (t) => t.code.toLowerCase() === String(tenantCode).toLowerCase());
  if (!tenant) return res.status(401).json({ error: "Organization code not found" });
  if (tenant.status !== "active") return res.status(403).json({ error: "This organization's account is currently suspended" });

  const user = await db.find(
    "users",
    (u) => u.tenantId === tenant.id && u.email.toLowerCase() === String(email).toLowerCase()
  );
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Incorrect email or password" });
  }
  if (user.status !== "active") return res.status(403).json({ error: "This account has been deactivated by your Superadmin" });

  if (user.mfaEnabled) {
    return res.json({ mfaRequired: true, mfaChallengeToken: signMfaChallenge(user), tenant: { id: tenant.id, name: tenant.name, code: tenant.code } });
  }

  const token = signToken(user);
  await activity.log({ tenantId: tenant.id, userId: user.id, actorName: user.name, role: user.role, action: "login", details: `${user.role} logged in` });
  res.json({ token, user: publicUser(user), tenant: { id: tenant.id, name: tenant.name, code: tenant.code } });
});

// Step 2 of login when MFA is enabled - exchange the short-lived challenge + a TOTP code
// for a real session token. Works for both superadmin and tenant users.
router.post("/login/mfa", async (req, res) => {
  const { mfaChallengeToken, token: totpToken, tenant } = req.body || {};
  if (!mfaChallengeToken || !totpToken) return res.status(400).json({ error: "mfaChallengeToken and token are required" });

  const payload = verifyMfaChallenge(mfaChallengeToken);
  if (!payload) return res.status(401).json({ error: "This login attempt has expired - please log in again" });

  const user = await db.getById(payload.sub);
  if (!user || !user.mfaEnabled) return res.status(401).json({ error: "MFA is not active for this account" });
  if (!mfa.verifyToken(totpToken, user.mfaSecret)) return res.status(401).json({ error: "Incorrect authentication code" });

  const sessionToken = signToken(user);
  await activity.log({ tenantId: user.tenantId, userId: user.id, actorName: user.name, role: user.role, action: "login", details: `${user.role} logged in (MFA verified)` });
  res.json({ token: sessionToken, user: publicUser(user), tenant: tenant || null });
});

function publicUser(u) {
  const { passwordHash, mfaSecret, mfaPendingSecret, ...rest } = u;
  return rest;
}

module.exports = router;
