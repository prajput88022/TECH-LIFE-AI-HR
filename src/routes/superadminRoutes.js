const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { hashPassword } = require("../services/authService");
const { FEATURE_CATALOG, defaultFeatureSet } = require("../featureCatalog");
const activity = require("../services/activityService");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"));

// ---- Feature catalog (static reference for the UI) ----
router.get("/feature-catalog", (req, res) => {
  res.json({ features: FEATURE_CATALOG });
});

// ---- Tenants ----
router.get("/tenants", async (req, res) => {
  const tenants = await db.all("tenants");
  const withSummaries = await Promise.all(tenants.map(withTenantSummary));
  res.json({ tenants: withSummaries });
});

router.post("/tenants", async (req, res) => {
  const { name, code, features } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: "Organization name and code are required" });

  const codeNorm = String(code).trim().toLowerCase();
  if (await db.find("tenants", (t) => t.code.toLowerCase() === codeNorm)) {
    return res.status(409).json({ error: "That organization code is already in use" });
  }

  const tenant = await db.insert("tenants", {
    name: String(name).trim(),
    code: codeNorm,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  const chosen = Array.isArray(features) && features.length ? features : defaultFeatureSet().filter((f) => f.enabled).map((f) => f.key);
  await Promise.all(FEATURE_CATALOG.map((f) =>
    db.insert("tenantFeatures", { tenantId: tenant.id, key: f.key, enabled: chosen.includes(f.key) })
  ));

  await activity.log({ tenantId: null, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "tenant.created", details: `Created tenant "${tenant.name}" (${tenant.code})` });

  res.status(201).json({ tenant: await withTenantSummary(tenant) });
});

router.patch("/tenants/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "suspended"].includes(status)) return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
  const tenant = await db.update("tenants", req.params.id, { status });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  await activity.log({ tenantId: tenant.id, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "tenant.status_changed", details: `Tenant ${tenant.name} set to ${status}` });
  res.json({ tenant: await withTenantSummary(tenant) });
});

// ---- Feature toggles per tenant ----
router.get("/tenants/:id/features", async (req, res) => {
  const tenant = await db.getById(req.params.id);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const flags = await db.all("tenantFeatures", (f) => f.tenantId === tenant.id);
  res.json({ features: FEATURE_CATALOG.map((f) => ({ ...f, enabled: !!flags.find((x) => x.key === f.key)?.enabled })) });
});

router.put("/tenants/:id/features", async (req, res) => {
  const tenant = await db.getById(req.params.id);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const { enabledKeys } = req.body || {};
  if (!Array.isArray(enabledKeys)) return res.status(400).json({ error: "enabledKeys must be an array of feature keys" });

  const existingFlags = await db.all("tenantFeatures", (f) => f.tenantId === tenant.id);
  await Promise.all(FEATURE_CATALOG.map((f) => {
    const existing = existingFlags.find((x) => x.key === f.key);
    const enabled = enabledKeys.includes(f.key);
    if (existing) return db.update("tenantFeatures", existing.id, { enabled });
    return db.insert("tenantFeatures", { tenantId: tenant.id, key: f.key, enabled });
  }));

  await activity.log({ tenantId: tenant.id, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "features.updated", details: `Features updated for ${tenant.name}: ${enabledKeys.join(", ") || "(none)"}` });

  const flags = await db.all("tenantFeatures", (f) => f.tenantId === tenant.id);
  res.json({ features: FEATURE_CATALOG.map((f) => ({ ...f, enabled: !!flags.find((x) => x.key === f.key)?.enabled })) });
});

// ---- Users under a tenant (HR / Management) ----
router.get("/tenants/:id/users", async (req, res) => {
  const users = (await db.all("users", (u) => u.tenantId === req.params.id)).map(publicUser);
  res.json({ users });
});

router.post("/tenants/:id/users", async (req, res) => {
  const tenant = await db.getById(req.params.id);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) return res.status(400).json({ error: "name, email, password and role are required" });
  if (!["hr", "management"].includes(role)) return res.status(400).json({ error: "role must be 'hr' or 'management'" });

  const exists = await db.find("users", (u) => u.tenantId === tenant.id && u.email.toLowerCase() === String(email).toLowerCase());
  if (exists) return res.status(409).json({ error: "A user with that email already exists in this organization" });

  const user = await db.insert("users", {
    tenantId: tenant.id,
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    passwordHash: hashPassword(password),
    role,
    status: "active",
    available: true,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
  });

  await activity.log({ tenantId: tenant.id, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "user.created", details: `Created ${role} user "${user.name}" for ${tenant.name}` });

  res.status(201).json({ user: publicUser(user) });
});

router.patch("/users/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!["active", "disabled"].includes(status)) return res.status(400).json({ error: "status must be 'active' or 'disabled'" });
  const user = await db.update("users", req.params.id, { status });
  if (!user) return res.status(404).json({ error: "User not found" });
  await activity.log({ tenantId: user.tenantId, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "user.status_changed", details: `${user.name} set to ${status}` });
  res.json({ user: publicUser(user) });
});

// ---- Platform-wide reports (all tenants) ----
router.get("/activity", async (req, res) => {
  const logs = (await db.all("activityLogs")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ logs });
});

router.get("/overview", async (req, res) => {
  const tenants = await db.all("tenants");
  const users = await db.all("users");
  const candidates = await db.all("candidates");
  res.json({
    tenantCount: tenants.length,
    activeTenantCount: tenants.filter((t) => t.status === "active").length,
    userCount: users.filter((u) => u.role !== "superadmin").length,
    candidateCount: candidates.length,
  });
});

// ---- Platform-wide integration status (real credentials live only in .env — see .env.sample) ----
const integrations = require("../services/integrationService");

router.get("/integrations", async (req, res) => {
  res.json({ categories: integrations.buildStatus() });
});

// Real connection tests — no send/call is placed, just a lightweight auth/connection check
// against the actual configured vendor. Lets Superadmin verify .env credentials from the UI.
router.post("/integrations/:category/test", async (req, res) => {
  const { category } = req.params;
  const notify = require("../services/notifyService");
  const webhooks = require("../services/webhookService");
  const mattermost = require("../services/mattermostService");
  const chatwoot = require("../services/chatwootService");
  try {
    let result;
    if (category === "mail_server") result = await notify.testEmailConnection();
    else if (category === "whatsapp") result = await notify.testWhatsappConnection();
    else if (category === "telephony") result = await notify.testTelephonyConnection();
    else if (category === "webhooks") result = await webhooks.testPing();
    else if (category === "team_chat") result = await mattermost.testConnection();
    else if (category === "chatwoot") result = await chatwoot.testConnection();
    else return res.status(400).json({ error: "This category has no live connection test" });

    await activity.log({ tenantId: null, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "integration.tested", details: `Tested ${category} — success: ${result.detail || "OK"}` });
    res.json({ ok: true, ...result });
  } catch (e) {
    await activity.log({ tenantId: null, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "integration.test_failed", details: `Tested ${category} — failed: ${e.message}` });
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---- Industry catalog management (add/remove custom industries platform-wide) ----
const industryService = require("../services/industryService");

router.get("/industries", async (req, res) => {
  res.json({ industries: await industryService.getAllIndustries() });
});

router.post("/industries", async (req, res) => {
  const { key, label, focusQuestion } = req.body || {};
  if (!key || !label) return res.status(400).json({ error: "key and label are required" });
  try {
    const industry = await industryService.addCustomIndustry({ key, label, focusQuestion });
    await activity.log({ tenantId: null, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "industry.added", details: `Added industry "${label}" (${industry.key})` });
    res.status(201).json({ industry });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete("/industries/:id", async (req, res) => {
  const ok = await industryService.removeCustomIndustry(req.params.id);
  if (!ok) return res.status(404).json({ error: "Custom industry not found" });
  await activity.log({ tenantId: null, userId: req.user.id, actorName: req.user.name, role: "superadmin", action: "industry.removed", details: `Removed custom industry ${req.params.id}` });
  res.json({ ok: true });
});

async function withTenantSummary(tenant) {
  const [users, candidates, flags] = await Promise.all([
    db.all("users", (u) => u.tenantId === tenant.id),
    db.all("candidates", (c) => c.tenantId === tenant.id),
    db.all("tenantFeatures", (f) => f.tenantId === tenant.id),
  ]);
  return { ...tenant, userCount: users.length, candidateCount: candidates.length, enabledFeatureCount: flags.filter((f) => f.enabled).length };
}

function publicUser(u) {
  const { passwordHash, mfaSecret, mfaPendingSecret, ...rest } = u;
  return rest;
}

module.exports = router;
