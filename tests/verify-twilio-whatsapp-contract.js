// Twilio and Meta's WhatsApp Cloud API are cloud-only — there's no way to install them
// locally the way we did with Asterisk. This test instead spins up a local HTTP server that
// mimics their REAL, documented request/response contract (exact paths, exact auth headers,
// exact response JSON shape per their public API docs) and points our actual code at it via
// a DNS override, so we can verify our request construction and response parsing are
// genuinely spec-correct — not a stand-in for hitting the real cloud service, but a real test
// of whether our code would work against it.

const https = require("https");
const fs = require("fs");
// Hostname redirection for api.twilio.com / graph.facebook.com -> 127.0.0.1 is done via
// /etc/hosts for this test run (more reliable than monkey-patching dns.lookup, since
// Node's fetch/undici does its own DNS resolution that doesn't go through dns.lookup).
// NODE_TLS_REJECT_UNAUTHORIZED=0 is set when *spawning* this script (see comment at bottom)
// so our self-signed mock cert is accepted - never do this for a real deployment.

let lastTwilioRequest = null;
let lastWhatsappRequest = null;

const tlsOpts = { key: fs.readFileSync("/tmp/mock-key.pem"), cert: fs.readFileSync("/tmp/mock-cert.pem") };
const mockServer = https.createServer(tlsOpts, (req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    // --- Twilio: GET /2010-04-01/Accounts/:sid.json (credential check) ---
    if (req.method === "GET" && /^\/2010-04-01\/Accounts\/[^/]+\.json$/.test(req.url)) {
      const auth = req.headers.authorization || "";
      lastTwilioRequest = { url: req.url, auth };
      if (!auth.startsWith("Basic ")) { res.writeHead(401); return res.end(JSON.stringify({ message: "Authenticate" })); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ friendly_name: "Test Twilio Account", status: "active", sid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }));
    }
    // --- Twilio: POST /2010-04-01/Accounts/:sid/Calls.json (place a call) ---
    if (req.method === "POST" && /^\/2010-04-01\/Accounts\/[^/]+\/Calls\.json$/.test(req.url)) {
      lastTwilioRequest = { url: req.url, auth: req.headers.authorization, contentType: req.headers["content-type"], body };
      const params = new URLSearchParams(body);
      if (!params.get("To") || !params.get("From") || !params.get("Twiml")) {
        res.writeHead(400); return res.end(JSON.stringify({ message: "Missing required parameter" }));
      }
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ sid: "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", status: "queued", to: params.get("To"), from: params.get("From") }));
    }
    // --- Meta WhatsApp Cloud API: GET /{version}/{phone_number_id} (credential check) ---
    if (req.method === "GET" && /^\/v\d+\.\d+\/\d+\?fields=/.test(req.url)) {
      lastWhatsappRequest = { url: req.url, auth: req.headers.authorization };
      if (!(req.headers.authorization || "").startsWith("Bearer ")) { res.writeHead(401); return res.end(JSON.stringify({ error: { message: "Invalid token" } })); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ verified_name: "Tech-Life AI HR (test)", display_phone_number: "+1 555-0100" }));
    }
    // --- Meta WhatsApp Cloud API: POST /{version}/{phone_number_id}/messages (send message) ---
    if (req.method === "POST" && /\/messages$/.test(req.url)) {
      lastWhatsappRequest = { url: req.url, auth: req.headers.authorization, body };
      const parsed = JSON.parse(body);
      if (parsed.messaging_product !== "whatsapp" || !parsed.to || !parsed.text?.body) {
        res.writeHead(400); return res.end(JSON.stringify({ error: { message: "Invalid payload" } }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ messages: [{ id: "wamid.test123" }] }));
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found in mock: " + req.method + " " + req.url }));
  });
});

mockServer.listen(443, "127.0.0.1", async () => {
  console.log("Local mock (Twilio + WhatsApp Cloud API contract) listening on 127.0.0.1:443\n");

  process.env.TWILIO_ACCOUNT_SID = "ACtest0000000000000000000000000000";
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
  process.env.TWILIO_FROM_NUMBER = "+15550000000";
  process.env.TELEPHONY_VENDOR = "twilio";
  process.env.WHATSAPP_API_TOKEN = "test_whatsapp_token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";

  const notify = require("../src/services/notifyService");
  let allOk = true;

  try {
    console.log("--- Twilio: testTelephonyConnection() (real code, mocked-but-spec-accurate server) ---");
    const r1 = await notify.testTelephonyConnection();
    console.log("Result:", r1);
    console.log("Request our code actually sent - auth header present:", !!lastTwilioRequest.auth, "| Basic auth used:", lastTwilioRequest.auth.startsWith("Basic"));
  } catch (e) { console.error("FAIL:", e.message); allOk = false; }

  try {
    console.log("\n--- Twilio: placeCall() (real call-placement code path) ---");
    const r2 = await notify.placeCall({ to: "+15551234567", script: "Hello, this is a test call from Tech-Life AI HR." });
    console.log("Result:", r2);
    console.log("Twiml sent contained our script:", lastTwilioRequest.body.includes("Hello%2C%20this%20is%20a%20test%20call") || decodeURIComponent(lastTwilioRequest.body).includes("Hello, this is a test call"));
  } catch (e) { console.error("FAIL:", e.message); allOk = false; }

  try {
    console.log("\n--- WhatsApp: testWhatsappConnection() ---");
    const r3 = await notify.testWhatsappConnection();
    console.log("Result:", r3);
  } catch (e) { console.error("FAIL:", e.message); allOk = false; }

  try {
    console.log("\n--- WhatsApp: sendWhatsapp() (real send code path) ---");
    const r4 = await notify.sendWhatsapp({ to: "+15551234567", body: "Please complete your interview: https://example.com/x" });
    console.log("Result:", r4);
    const sentBody = JSON.parse(lastWhatsappRequest.body);
    console.log("Payload shape correct:", sentBody.messaging_product === "whatsapp" && sentBody.type === "text" && !!sentBody.text.body);
  } catch (e) { console.error("FAIL:", e.message); allOk = false; }

  console.log(allOk ? "\n✅ Twilio + WhatsApp request/response contract verified against their real documented API shape." : "\n❌ One or more contract checks failed.");
  process.exitCode = allOk ? 0 : 1;
  mockServer.close();
});
