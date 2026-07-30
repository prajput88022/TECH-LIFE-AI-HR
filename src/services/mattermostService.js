// Mattermost integration.
//
// 1. Notifications: uses a real Mattermost Incoming Webhook (Mattermost's own simple,
//    well-documented POST-a-JSON-blob mechanism — Settings > Integrations > Incoming
//    Webhooks on any Mattermost server) to post real-time alerts into an HR/ops channel:
//    anger detected on a call, a case now needs Management approval, a decision was finalized.
//
// 2. Meeting links: Mattermost's Calls plugin turns any channel into a voice/video room.
//    There's no stable public API to mint a one-off call link outside that plugin's internal
//    APIs (which vary by server version), so the well-documented, stable pattern many teams
//    actually use is shared here instead: link straight to the channel
//    (`<server>/<team>/channels/<channel>`) — if Calls is enabled on that channel, joining the
//    channel and clicking "Start/Join Call" starts the meeting. This is a real, working,
//    stable link — just one extra click rather than a deep link straight into an active call.

async function sendNotification(text) {
  const webhookUrl = process.env.MATTERMOST_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("Mattermost is not configured — set MATTERMOST_WEBHOOK_URL in .env");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      username: "Tech-Life AI HR",
      channel: process.env.MATTERMOST_CHANNEL || undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mattermost webhook rejected the message (${res.status}): ${body.slice(0, 200)}`);
  }
  return { ok: true };
}

function getMeetingLink() {
  const url = process.env.MATTERMOST_URL;
  const team = process.env.MATTERMOST_TEAM;
  const channel = process.env.MATTERMOST_CHANNEL_NAME;
  if (!url || !team || !channel) return null;
  return `${url.replace(/\/$/, "")}/${team}/channels/${channel}`;
}

async function testConnection() {
  await sendNotification("✅ Tech-Life AI HR — test notification. If you can see this in Mattermost, the Incoming Webhook is configured correctly.");
  return { ok: true, detail: `Sent a real test message via the configured Incoming Webhook${process.env.MATTERMOST_CHANNEL ? ` to #${process.env.MATTERMOST_CHANNEL}` : ""}` };
}

module.exports = { sendNotification, getMeetingLink, testConnection };
