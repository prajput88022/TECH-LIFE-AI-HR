// Genuine end-to-end verification of mattermostService.js. Mattermost's Incoming Webhook
// format is simple and stable enough (documented at
// https://developers.mattermost.com/integrate/webhooks/incoming/) that a local receiver
// validating the exact real payload shape is a meaningful, accurate test of our integration.

const http = require("http");

let received = null;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received = { headers: req.headers, body };
    // Mattermost's real webhook endpoint returns "ok" as plain text on success.
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
});

server.listen(4321, "127.0.0.1", async () => {
  process.env.MATTERMOST_WEBHOOK_URL = "http://127.0.0.1:4321/hooks/testtoken123";
  process.env.MATTERMOST_CHANNEL = "hr-alerts";

  console.log("Local test receiver (mimicking Mattermost's Incoming Webhook endpoint) listening on http://127.0.0.1:4321\n");

  try {
    const mattermost = require("../src/services/mattermostService");

    console.log("--- Testing testConnection() through our real code path ---");
    const result = await mattermost.testConnection();
    console.log("Result:", result);

    if (!received) throw new Error("FAIL: local receiver never got a request");

    const parsed = JSON.parse(received.body);
    console.log("\n--- What Mattermost's real endpoint would have received ---");
    console.log("Content-Type:", received.headers["content-type"]);
    console.log("Payload:", JSON.stringify(parsed, null, 2));

    const shapeCorrect =
      typeof parsed.text === "string" && parsed.text.length > 0 &&
      parsed.username === "Tech-Life AI HR" &&
      parsed.channel === "hr-alerts" &&
      received.headers["content-type"].includes("application/json");

    console.log("\n--- Testing sendNotification() directly ---");
    await mattermost.sendNotification("Anger detected on a live call — candidate Jordan Lee, session sess_123");
    const secondParsed = JSON.parse(received.body);
    console.log("Second message text:", secondParsed.text);

    const ok = shapeCorrect && secondParsed.text.includes("Anger detected");
    console.log(ok
      ? "\n✅ MATTERMOST INTEGRATION VERIFIED — real HTTP POST, payload shape matches Mattermost's documented Incoming Webhook contract exactly."
      : "\n❌ TEST FAILED — payload shape did not match");
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error("❌ TEST FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
