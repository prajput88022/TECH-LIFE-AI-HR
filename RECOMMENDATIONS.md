# Recommendations & Roadmap

Honest list of what to do before treating this as a production system, in rough priority order.

## 1. Data & infrastructure
- **Run against a real CouchDB cluster** (`COUCHDB_URL`), not the embedded local store, for any
  multi-instance or multi-machine deployment — the embedded store is single-process/single-disk.
- **Encrypt secrets at rest.** `integrationConfig` documents currently store API keys / SMTP
  passwords / telephony credentials in plain text in CouchDB. Add field-level encryption (e.g. a
  KMS-backed envelope key) before go-live.
- **Back up CouchDB** on a schedule; enable CouchDB's built-in replication to a standby cluster.
- **Move JWT_SECRET, SMTP creds, etc. to a real secrets manager** (Vault, AWS Secrets Manager, …)
  instead of `.env` in production.

## 2. Real-time / WebRTC
- **Add TURN servers.** The current STUN-only config (`stun:stun.l.google.com:19302`) will fail
  to connect whenever either party is behind a symmetric NAT/strict firewall (common on corporate
  networks). Stand up coturn or use a managed TURN provider.
- **Move from 2-party mesh to an SFU** (mediasoup, LiveKit, Janus) if you ever need more than two
  participants in a room (e.g. a panel interview), or want server-side recording.
- **Add reconnection handling** to the Socket.IO client (network blips currently just drop the
  call) and a "reconnecting…" UI state.
- **Recording & consent.** If you record interviews, capture explicit candidate consent before
  the room starts and store recordings with the same retention/encryption policy as other PII.

## 3. Voice AI (ASR / TTS / LLM)
- **Swap browser Web Speech API for a production ASR/TTS vendor** (Deepgram/Whisper for ASR,
  ElevenLabs/Azure/Google for TTS) once you need: non-Chromium browser support, non-English
  languages/accents at scale, or telephony (PSTN) calls where there's no browser at all.
- **Add an LLM-backed dynamic follow-up layer.** Today's AI interviewer asks a fixed question
  list; the "Industry & Level Adaptive Question Engine" design calls for dynamic probing on vague
  answers — that needs the `llm` integration actually wired into a conversation loop
  (`src/services/botEngine.js` — not yet built) rather than the static list in
  `formTemplates.js`.
- **Score responses automatically** (keyword/embedding-based or LLM-graded) instead of just
  storing raw transcript text, so HR sees a suggested score/summary, not just a wall of text.

## 4. Telephony (PSTN calls)
- **Asterisk:** implement the AMI `Originate` action in `notifyService.placeCallReal()` using
  `cfg.amiHost/amiPort/amiUser/amiSecret`, bridging the call into an IVR that streams audio to/from
  your ASR/TTS pipeline.
- **FreeSWITCH:** same idea via ESL (`originate` command).
- **Twilio:** simplest to stand up first — REST API call + TwiML `<Connect><Stream>` to pipe audio
  to a WebSocket for ASR/TTS.
- Add **call retry/backoff and DND/compliance handling** (do-not-call lists, calling-hours
  restrictions per region) before dialing real numbers.

## 5. Messaging
- **WhatsApp:** wire the WhatsApp Cloud API (Meta) or Twilio WhatsApp in
  `notifyService.sendWhatsappReal()`. Requires a verified WhatsApp Business number and message
  template approval for the first outbound message in a conversation.
- **Email deliverability:** once live SMTP is configured, set up SPF/DKIM/DMARC for the sending
  domain so invite/result emails don't land in spam.

## 6. Meeting platform integrations
- **Google Meet / Microsoft Teams:** the "meeting" integration category is stubbed for OAuth
  client credentials. To actually generate a Meet/Teams link, call Google Calendar API
  (`conferenceData.createRequest`) or Microsoft Graph (`onlineMeetings` endpoint) when scheduling,
  and store the returned join URL on the `interviewSessions` doc instead of/alongside the built-in
  WebRTC room.

## 7. Security & compliance
- **Rate-limit and CAPTCHA the public routes** (`/api/public/*`) — they're unauthenticated by
  design (candidates don't log in), so add abuse protection (rate limiting per IP/token, a
  CAPTCHA on the invite-accept step) before exposing this to the internet.
- **Rotate `formToken`s** or add expiry — currently a candidate's token is valid indefinitely.
- **Tenant-level data isolation audit.** Every route scopes by `tenantId`, but a security review
  (or automated test suite) should assert no endpoint can be tricked into returning another
  tenant's data.
- **GDPR/DPDP-style data subject rights** — add candidate data export/delete endpoints if you
  operate in a jurisdiction that requires them.

## 8. Product gaps worth closing next
- A dedicated **KPI import** endpoint/UI for promotion cases (the `kpi_analytics` feature flag
  exists but there's no ingestion UI yet — see the original project brief's "KPI & Performance
  Analytics Engine").
- **Webhook delivery** to external ATS/HRMS systems (the `webhook_api` feature flag exists; add an
  outbound webhook dispatcher + signing, mirroring the design in the original project charter
  document).
- **Bulk candidate import** (CSV) instead of one-at-a-time creation.
- **Panel interviews** (more than one HR/Management participant in a room at once) — needs the SFU
  work in section 2 first.
