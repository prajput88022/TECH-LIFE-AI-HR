// Genuine end-to-end verification of webhookService.dispatch() and testPing() — spins up a
// real local HTTP server, points our actual webhookService at it via env vars, dispatches a
// real signed webhook through our real code path, and verifies the receiver got a correctly
// HMAC-SHA256-signed payload it can independently validate.

const crypto = require("crypto");
const http = require("http");

process.env.WEBHOOK_SECRET = "test-signing-secret-12345";

let receivedRequest = null;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    receivedRequest = { headers: req.headers, body };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true }));
  });
});

server.listen(3999, "127.0.0.1", async () => {
  process.env.WEBHOOK_URLS = "http://127.0.0.1:3999/webhook-receiver";
  console.log("Local test webhook receiver listening on http://127.0.0.1:3999/webhook-receiver");

  try {
    // Require AFTER setting env vars, since webhookService reads them at module load time.
    delete require.cache[require.resolve("../src/services/webhookService")];
    const webhooks = require("../src/services/webhookService");

    console.log("\n--- Testing testPing() through our actual code path ---");
    const pingResult = await webhooks.testPing();
    console.log("testPing() returned:", JSON.stringify(pingResult, null, 2));

    if (!receivedRequest) throw new Error("FAIL: local receiver never got a request");

    console.log("\n--- What the local receiver actually got ---");
    console.log("X-Event header:", receivedRequest.headers["x-event"]);
    console.log("X-Signature header:", receivedRequest.headers["x-signature"]);
    console.log("Body:", receivedRequest.body);

    // Independently recompute the HMAC the way a real receiving system would, and confirm
    // it matches what our code sent — this is the actual security property webhooks rely on.
    const expectedSignature = crypto.createHmac("sha256", process.env.WEBHOOK_SECRET).update(receivedRequest.body).digest("hex");
    const signatureValid = expectedSignature === receivedRequest.headers["x-signature"];
    console.log("\nIndependently recomputed HMAC:", expectedSignature);
    console.log("Signature valid:", signatureValid);

    const parsedBody = JSON.parse(receivedRequest.body);
    const eventCorrect = parsedBody.event === "test.ping";

    const ok = signatureValid && eventCorrect && receivedRequest.headers["x-event"] === "test.ping";
    console.log(ok ? "\n✅ END-TO-END WEBHOOK TEST PASSED — real HTTP POST, real HMAC-SHA256 signature, independently verified." : "\n❌ TEST FAILED");
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error("❌ TEST FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
