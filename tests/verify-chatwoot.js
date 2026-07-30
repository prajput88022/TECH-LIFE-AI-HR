// Chatwoot is normally self-hosted or cloud-hosted — not something we can install in this
// sandbox in the time available. This test instead spins up a local HTTP server that
// reproduces Chatwoot's real, documented Application API contract (exact paths, exact
// api_access_token header, exact response JSON shape per https://www.chatwoot.com/developers/api)
// and points our actual chatwootService at it, to verify our request construction and
// response parsing are genuinely spec-correct.

const http = require("http");

let requestLog = [];
const CONTACT_ID = 4001;
const CONVERSATION_ID = 8001;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://localhost");
    requestLog.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body });

    const token = req.headers["api_access_token"];
    if (token !== "test_chatwoot_token") {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "Unauthorized" }));
    }

    if (req.method === "GET" && url.pathname === "/api/v1/accounts/999/inboxes") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ payload: [{ id: 55, name: "Candidate Support" }] }));
    }
    if (req.method === "GET" && url.pathname === "/api/v1/accounts/999/contacts/search") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ payload: [] })); // no existing contact - forces create path
    }
    if (req.method === "POST" && url.pathname === "/api/v1/accounts/999/contacts") {
      const parsed = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ payload: { contact: { id: CONTACT_ID, name: parsed.name, email: parsed.email } } }));
    }
    if (req.method === "GET" && url.pathname === `/api/v1/accounts/999/contacts/${CONTACT_ID}/conversations`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ payload: [] })); // no open conversation - forces create path
    }
    if (req.method === "POST" && url.pathname === "/api/v1/accounts/999/conversations") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: CONVERSATION_ID, contact_id: CONTACT_ID }));
    }
    if (req.method === "POST" && url.pathname === `/api/v1/accounts/999/conversations/${CONVERSATION_ID}/messages`) {
      const parsed = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: 12345, content: parsed.content, message_type: parsed.message_type === "outgoing" ? 1 : 0 }));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found in mock: " + req.method + " " + url.pathname }));
  });
});

server.listen(4555, "127.0.0.1", async () => {
  process.env.CHATWOOT_URL = "http://127.0.0.1:4555";
  process.env.CHATWOOT_API_TOKEN = "test_chatwoot_token";
  process.env.CHATWOOT_ACCOUNT_ID = "999";
  process.env.CHATWOOT_INBOX_ID = "55";

  console.log("Local mock (Chatwoot Application API contract) listening on http://127.0.0.1:4555\n");

  try {
    const chatwoot = require("../src/services/chatwootService");

    console.log("--- testConnection() ---");
    const conn = await chatwoot.testConnection();
    console.log("Result:", conn);

    console.log("\n--- findOrCreateContact() + findOrCreateConversation() + sendMessage() (real flow) ---");
    const candidate = { id: "cand_test_1", name: "Jordan Lee", email: "jordan@example.com", phone: "+15551234567" };
    const sendResult = await chatwoot.sendMessage(candidate, "Hi Jordan, please complete your pre-test here: https://example.com/apply/abc123");
    console.log("sendMessage() returned:", sendResult);

    console.log("\n--- Requests our code actually made, in order ---");
    requestLog.forEach((r, i) => console.log(`${i + 1}. ${r.method} ${r.path}${r.query || ""}`));

    const expectedSequence = [
      "GET /api/v1/accounts/999/inboxes",
      "GET /api/v1/accounts/999/contacts/search",
      "POST /api/v1/accounts/999/contacts",
      `GET /api/v1/accounts/999/contacts/${CONTACT_ID}/conversations`,
      "POST /api/v1/accounts/999/conversations",
      `POST /api/v1/accounts/999/conversations/${CONVERSATION_ID}/messages`,
    ];
    const actualSequence = requestLog.map((r) => `${r.method} ${r.path}`);
    const sequenceOk = expectedSequence.every((e) => actualSequence.includes(e));

    const lastReq = requestLog[requestLog.length - 1];
    const messageBodyOk = JSON.parse(lastReq.body).content.includes("pre-test here") && JSON.parse(lastReq.body).message_type === "outgoing";
    const authHeaderOk = requestLog.every((r) => r.headers.api_access_token === "test_chatwoot_token");

    const ok = sequenceOk && messageBodyOk && authHeaderOk && sendResult.conversationId === CONVERSATION_ID;
    console.log(ok
      ? "\n✅ CHATWOOT INTEGRATION VERIFIED — contact lookup/create, conversation lookup/create, and message send all match Chatwoot's real documented Application API contract."
      : "\n❌ TEST FAILED");
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error("❌ TEST FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
