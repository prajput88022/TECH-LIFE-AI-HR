const express = require("express");
const db = require("../db");
const { verifyPassword, signToken } = require("../services/authService");
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

  const token = signToken(user);
  await activity.log({ tenantId: tenant.id, userId: user.id, actorName: user.name, role: user.role, action: "login", details: `${user.role} logged in` });

  res.json({ token, user: publicUser(user), tenant: { id: tenant.id, name: tenant.name, code: tenant.code } });
});

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

module.exports = router;
