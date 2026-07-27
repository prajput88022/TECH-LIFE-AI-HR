const db = require("./db");
const { hashPassword } = require("./services/authService");
const { defaultFeatureSet } = require("./featureCatalog");
const crypto = require("crypto");

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || "superadmin@techlife.ai";
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || "SuperAdmin@123";

async function ensureSeeded() {
  let superadmin = await db.find("users", (u) => u.role === "superadmin");
  if (!superadmin) {
    superadmin = await db.insert("users", {
      tenantId: null,
      name: "Platform Superadmin",
      email: SUPERADMIN_EMAIL,
      passwordHash: hashPassword(SUPERADMIN_PASSWORD),
      role: "superadmin",
      status: "active",
      createdAt: new Date().toISOString(),
    });
    console.log(`Seeded superadmin -> email: ${SUPERADMIN_EMAIL}  password: ${SUPERADMIN_PASSWORD}`);
  }

  let tenant = await db.find("tenants", (t) => t.code === "demo");
  if (!tenant) {
    tenant = await db.insert("tenants", {
      name: "Demo Corp",
      code: "demo",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    await Promise.all(defaultFeatureSet().map((f) => db.insert("tenantFeatures", { tenantId: tenant.id, key: f.key, enabled: f.key === "kpi_analytics" ? true : f.enabled })));

    const hr = await db.insert("users", {
      tenantId: tenant.id,
      name: "Priya Sharma",
      email: "hr@demo.com",
      passwordHash: hashPassword("Demo@123"),
      role: "hr",
      status: "active",
      available: true,
      createdAt: new Date().toISOString(),
    });

    await db.insert("users", {
      tenantId: tenant.id,
      name: "Rohit Verma",
      email: "management@demo.com",
      passwordHash: hashPassword("Demo@123"),
      role: "management",
      status: "active",
      available: true,
      createdAt: new Date().toISOString(),
    });

    const candidate = await db.insert("candidates", {
      tenantId: tenant.id,
      name: "Sample Candidate",
      email: "candidate@example.com",
      phone: "9999999999",
      industry: "it_ites",
      level: "associate",
      appliedRole: "Software Engineer",
      caseType: "screening",
      status: "created",
      formToken: crypto.randomBytes(16).toString("hex"),
      createdBy: hr.id,
      createdByName: hr.name,
      createdAt: new Date().toISOString(),
    });

    console.log(`Seeded demo tenant -> code: demo | hr@demo.com / Demo@123 | management@demo.com / Demo@123`);
    console.log(`Sample candidate invite link -> /invite.html?token=${candidate.formToken}`);
  }
}

module.exports = { ensureSeeded };
