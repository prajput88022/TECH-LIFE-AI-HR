// Real outbound webhook delivery to an organization's ATS/HRMS/CRM/BI stack.
// Target URL(s) and signing secret come from environment variables (WEBHOOK_URLS,
// WEBHOOK_SECRET) — see .env.sample. Every payload is HMAC-SHA256 signed so the
// receiving system can verify authenticity before processing (header: X-Signature).

const crypto = require("crypto");
const db = require("../db");

const WEBHOOK_URLS = (process.env.WEBHOOK_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

function sign(bodyString) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(bodyString).digest("hex");
}

async function dispatch(event, tenantId, payload) {
  if (!WEBHOOK_URLS.length) return { delivered: false, reason: "No WEBHOOK_URLS configured" };

  // Only fire for tenants that have the webhook_api feature enabled.
  if (tenantId) {
    const flag = await db.find("tenantFeatures", (f) => f.tenantId === tenantId && f.key === "webhook_api");
    if (!flag || !flag.enabled) return { delivered: false, reason: "webhook_api feature not enabled for this tenant" };
  }

  const body = JSON.stringify({ event, tenantId, data: payload, sentAt: new Date().toISOString() });
  const signature = sign(body);

  const results = await Promise.all(WEBHOOK_URLS.map(async (url) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Signature": signature, "X-Event": event },
        body,
      });
      return { url, status: res.status, ok: res.ok };
    } catch (err) {
      return { url, status: null, ok: false, error: err.message };
    }
  }));

  await db.insert("webhookDeliveries", {
    tenantId: tenantId || null,
    event,
    urls: WEBHOOK_URLS,
    results,
    payloadPreview: JSON.stringify(payload).slice(0, 500),
    deliveredAt: new Date().toISOString(),
  });

  return { delivered: true, results };
}

async function testPing() {
  if (!WEBHOOK_URLS.length) throw new Error("No WEBHOOK_URLS configured");
  if (!WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET is not set");
  const body = JSON.stringify({ event: "test.ping", data: { message: "Test ping from Tech-Life AI HR" }, sentAt: new Date().toISOString() });
  const signature = sign(body);
  const results = await Promise.all(WEBHOOK_URLS.map(async (url) => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": signature, "X-Event": "test.ping" }, body });
      return { url, status: res.status, ok: res.ok };
    } catch (err) {
      return { url, status: null, ok: false, error: err.message };
    }
  }));
  const anyOk = results.some((r) => r.ok);
  if (!anyOk) throw new Error("None of the configured webhook URLs accepted the test ping: " + JSON.stringify(results));
  return { ok: true, results };
}

module.exports = { dispatch, testPing };
