// Chatwoot integration (https://www.chatwoot.com) — open-source customer engagement / live
// chat platform. Used here as an additional candidate communication channel: HR can message a
// candidate through a real Chatwoot conversation (visible to the whole HR team in Chatwoot's
// own agent inbox, with full chat history), instead of/alongside email/WhatsApp/call.
//
// Uses Chatwoot's Application API (authenticated with an agent API access token — Profile
// Settings > Access Token in any Chatwoot account). Docs: https://www.chatwoot.com/developers/api

function baseUrl() {
  const url = process.env.CHATWOOT_URL;
  if (!url) throw new Error("Chatwoot is not configured — set CHATWOOT_URL/API_TOKEN/ACCOUNT_ID/INBOX_ID in .env");
  return url.replace(/\/$/, "");
}

function headers() {
  const token = process.env.CHATWOOT_API_TOKEN;
  if (!token) throw new Error("Chatwoot is not configured — set CHATWOOT_API_TOKEN in .env");
  return { "Content-Type": "application/json", api_access_token: token };
}

function accountId() {
  const id = process.env.CHATWOOT_ACCOUNT_ID;
  if (!id) throw new Error("Chatwoot is not configured — set CHATWOOT_ACCOUNT_ID in .env");
  return id;
}

function inboxId() {
  const id = process.env.CHATWOOT_INBOX_ID;
  if (!id) throw new Error("Chatwoot is not configured — set CHATWOOT_INBOX_ID in .env");
  return id;
}

async function req(method, path, body) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Chatwoot API error (${res.status}): ${data.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function testConnection() {
  // Lightweight, read-only, real call: list inboxes for the configured account and confirm
  // the configured inbox ID is among them.
  const data = await req("GET", `/api/v1/accounts/${accountId()}/inboxes`);
  const inboxes = data.payload || [];
  const match = inboxes.find((i) => String(i.id) === String(inboxId()));
  if (!match) throw new Error(`Connected, but inbox ID ${inboxId()} was not found in this account's inbox list`);
  return { ok: true, detail: `Connected to Chatwoot account, inbox "${match.name}" confirmed` };
}

async function findOrCreateContact(candidate) {
  // Search first (Chatwoot dedupes on identifier/email server-side too, but searching lets us
  // reuse an existing contact/conversation across repeated sends to the same candidate).
  if (candidate.email) {
    const search = await req("GET", `/api/v1/accounts/${accountId()}/contacts/search?q=${encodeURIComponent(candidate.email)}`);
    const existing = (search.payload || [])[0];
    if (existing) return existing;
  }
  const created = await req("POST", `/api/v1/accounts/${accountId()}/contacts`, {
    inbox_id: Number(inboxId()),
    name: candidate.name,
    email: candidate.email || undefined,
    phone_number: candidate.phone || undefined,
  });
  return created.payload?.contact || created;
}

async function findOrCreateConversation(candidate) {
  const contact = await findOrCreateContact(candidate);
  const contactId = contact.id || contact.contact?.id;

  const existingConvos = await req("GET", `/api/v1/accounts/${accountId()}/contacts/${contactId}/conversations`);
  const open = (existingConvos.payload || []).find((c) => c.status !== "resolved");
  if (open) return { conversationId: open.id, contactId };

  const created = await req("POST", `/api/v1/accounts/${accountId()}/conversations`, {
    source_id: `techlifehr-${candidate.id}`,
    inbox_id: Number(inboxId()),
    contact_id: contactId,
  });
  return { conversationId: created.id, contactId };
}

async function sendMessage(candidate, text) {
  const { conversationId } = await findOrCreateConversation(candidate);
  const message = await req("POST", `/api/v1/accounts/${accountId()}/conversations/${conversationId}/messages`, {
    content: text,
    message_type: "outgoing",
  });
  return { conversationId, messageId: message.id };
}

module.exports = { testConnection, findOrCreateContact, findOrCreateConversation, sendMessage };
