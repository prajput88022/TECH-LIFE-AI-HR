const db = require("../db");

async function log({ tenantId, userId, actorName, role, action, details }) {
  return db.insert("activityLogs", {
    tenantId: tenantId || null,
    userId: userId || null,
    actorName: actorName || "System",
    role: role || "system",
    action,
    details: details || "",
    createdAt: new Date().toISOString(),
  });
}

module.exports = { log };
