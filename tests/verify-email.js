// Genuine end-to-end verification of notifyService.sendEmail() — spins up a real local
// SMTP server (smtp-server), points our actual notifyService at it via env vars, sends a
// real email through our real code path, and asserts the local server actually received it.
// This is not a mock of our code — it's our real nodemailer integration talking to a real
// (local) SMTP server over the real SMTP protocol.

process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "2526";
process.env.SMTP_SECURE = "false";
process.env.SMTP_USER = "testuser";
process.env.SMTP_PASSWORD = "testpass";
process.env.SMTP_FROM_EMAIL = "hr@techlife-test.local";
process.env.SMTP_FROM_NAME = "Tech-Life AI HR (test)";

const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");

let receivedMail = null;

const server = new SMTPServer({
  authOptional: false,
  onAuth(auth, session, callback) {
    if (auth.username === "testuser" && auth.password === "testpass") return callback(null, { user: "testuser" });
    return callback(new Error("Invalid credentials"));
  },
  onData(stream, session, callback) {
    simpleParser(stream, {}, (err, parsed) => {
      if (!err) receivedMail = parsed;
      callback();
    });
  },
  disabledCommands: ["STARTTLS"],
});

server.listen(2526, "127.0.0.1", async () => {
  console.log("Local test SMTP server listening on 127.0.0.1:2526");
  try {
    const notify = require("../src/services/notifyService");

    console.log("\n--- Testing testEmailConnection() (auth handshake, no send) ---");
    const testResult = await notify.testEmailConnection();
    console.log("PASS:", testResult);

    console.log("\n--- Testing real sendEmail() through our actual code path ---");
    const sendResult = await notify.sendEmail({
      to: "candidate@example.com",
      subject: "Your Tech-Life AI HR interview link",
      body: "Hi Jordan, please complete your interview here: https://example.com/interview/abc123",
    });
    console.log("sendEmail() returned:", sendResult);

    await new Promise((r) => setTimeout(r, 300));

    if (!receivedMail) throw new Error("FAIL: local SMTP server never received a message");
    console.log("\n--- What the local SMTP server actually received ---");
    console.log("From:", receivedMail.from.text);
    console.log("To:", receivedMail.to.text);
    console.log("Subject:", receivedMail.subject);
    console.log("Body:", receivedMail.text);

    const ok =
      receivedMail.to.text.includes("candidate@example.com") &&
      receivedMail.subject.includes("Tech-Life AI HR") &&
      receivedMail.text.includes("interview/abc123");

    console.log(ok ? "\n✅ END-TO-END EMAIL TEST PASSED — real code, real SMTP protocol, real received message." : "\n❌ TEST FAILED — content mismatch");
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error("❌ TEST FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
