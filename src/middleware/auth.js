const { verifyToken } = require("../services/authService");
const db = require("../db");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired session, please login again" });

  const user = await db.getById(payload.sub);
  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "Account not found or deactivated" });
  }

  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action" });
    }
    next();
  };
}

// Ensures a non-superadmin user only ever touches their own tenant's data.
function scopeTenantId(req) {
  if (req.user.role === "superadmin") {
    return req.query.tenantId || req.body.tenantId || null; // superadmin may pass a target tenant explicitly
  }
  return req.user.tenantId;
}

// Blocks the request if the tenant does not have the given feature switched on.
function requireFeature(featureKey) {
  return async (req, res, next) => {
    const tenantId = scopeTenantId(req) || req.user.tenantId;
    if (req.user.role === "superadmin" && !tenantId) return next(); // superadmin acting platform-wide
    const tf = await db.find("tenantFeatures", (f) => f.tenantId === tenantId && f.key === featureKey);
    if (!tf || !tf.enabled) {
      return res.status(403).json({ error: `This feature ("${featureKey}") is not enabled for your organization. Ask your Superadmin to enable it.` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireFeature, scopeTenantId };
