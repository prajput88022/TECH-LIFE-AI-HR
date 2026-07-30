# Recommendations & Roadmap

Honest, current list of what's resolved, what's real-but-unverified (needs real credentials/infra
this environment can't reach), and what's a genuine remaining gap. Updated to reflect the
real-world integrations, call recording/analysis, reports page, rate limiting, and integration
test tooling added in this version.

## ✅ Resolved in this version
- ~~Secrets stored in plaintext in CouchDB~~ → Secrets now live **only** in `.env`, never the
  database. Nothing sent to the browser contains a credential.
- ~~No consent capture before recording~~ → Candidates must explicitly consent before their
  interview room becomes usable (`POST /api/public/room/:token/consent`).
- ~~No call recording~~ → Real `MediaRecorder` + Web Audio mixing records every session,
  uploaded and stored as a CouchDB attachment.
- ~~No rate limiting on public endpoints~~ → In-memory sliding-window limiter on every
  `/api/public/*` route; verified triggering `429` under load.
- ~~No way to verify vendor credentials without a real send~~ → Superadmin Integrations page has
  real "Test connection" buttons, and every one of them has now been **genuinely exercised**,
  not just code-reviewed — see the next section.
- ~~No outbound webhook system~~ → Real HMAC-signed webhook dispatch on 7 event types, verified
  against a real local receiver with an independently recomputed signature.
- ~~No approval routing by seniority~~ → HR is blocked from finalizing GM/VP-level decisions;
  only Management/Superadmin can.
- ~~No pass-threshold auto-screening~~ → Configurable per tenant, tested end-to-end.
- ~~Aptitude/Personality/Communication not assignable~~ → HR chooses which sections to include
  per candidate at creation time.
- ~~No team notification channel for urgent events~~ → Mattermost Incoming Webhook alerts on
  anger-detected calls and Management-approval-needed cases, verified against a payload-contract
  test.
- ~~No live-chat / unified-inbox candidate communication channel~~ → Chatwoot integration
  (contact/conversation/message via their real Application API), verified against a
  payload-contract test.

## ✅ "Real code, unverifiable" from the previous version — now actually verified
Every one of these has been exercised against something real this time, not just reviewed for
correctness. Run them yourself with `npm run verify:*` — see `tests/README.md` for full detail:

| Integration | How it was verified |
|---|---|
| SMTP email | Real local SMTP server (`smtp-server`), full protocol handshake, real message received and content-checked |
| Outbound webhooks | Real local HTTP receiver, HMAC-SHA256 signature independently recomputed and matched |
| **Asterisk AMI** | **A real, locally-installed Asterisk 20 server** (`apt-get install asterisk`) — real TCP socket, real `Login`/`Originate`/`Logoff` AMI actions exchanged, bad credentials confirmed correctly rejected |
| Twilio + WhatsApp Cloud API | No local install exists for these cloud-only services, so verified against a local server reproducing their exact documented request/response contract (paths, auth headers, required fields, response shape) |
| Mattermost | Local receiver reproducing Mattermost's documented Incoming Webhook payload contract |
| Chatwoot | Local receiver reproducing Chatwoot's documented Application API contract (contact → conversation → message flow) |

**What's still genuinely unverified:** FreeSWITCH (no apt package available in a stock Ubuntu
sandbox — its official repo requires a SignalWire account as of 2024), and — inherently — a
*live* account with real credentials and real network access to any of these real cloud
services. Everything above proves the code is protocol/contract-correct; only a real account and
a network route to the real service can prove the very last mile, and that's on you to do once
you deploy this somewhere with outbound internet access and real credentials.



## 1. Data & infrastructure
- **Run against a real CouchDB cluster** (`COUCHDB_URL` or the granular `COUCHDB_HOST/PORT/USER/
  PASSWORD/DBNAME` vars), not the embedded local store, for any multi-instance deployment.
- **Back up CouchDB** on a schedule; enable CouchDB's built-in replication to a standby cluster.
- **Move `.env` secrets to a real secrets manager** (Vault, AWS Secrets Manager, …) for production
  — `.env` is fine for a single-host deployment, less so at scale.
- **Persist the rate limiter externally (Redis)** if you run more than one server process/instance
  behind a load balancer — the current limiter is in-memory per process.

## 2. Real-time / WebRTC
- **Add TURN servers.** The current STUN-only config (`stun:stun.l.google.com:19302`) will fail
  to connect whenever either party is behind a symmetric NAT/strict firewall (common on corporate
  networks). Stand up coturn or use a managed TURN provider.
- **Move from 2-party mesh to an SFU** (mediasoup, LiveKit, Janus) if you ever need more than two
  participants in a room (e.g. a panel interview).
- **Add reconnection handling** to the Socket.IO client (network blips currently just drop the
  call) and a "reconnecting…" UI state.
- **Recorded file lifecycle** — recordings are stored indefinitely as CouchDB attachments today;
  add a retention policy / archival-to-cold-storage job before this accumulates unbounded storage.

## 3. Voice AI (ASR / TTS / LLM)
- **Swap browser Web Speech API for a production ASR/TTS vendor** (Deepgram/Whisper for ASR,
  ElevenLabs/Azure/Google for TTS) once you need: non-Chromium browser support, non-English
  languages/accents at scale, or telephony (PSTN) calls where there's no browser at all.
- **Add an LLM-backed dynamic follow-up layer.** Today's AI interviewer asks a fixed question
  list; a real implementation would have it probe deeper on vague answers using the configured
  `LLM_PROVIDER`/`LLM_API_KEY`.
- **Upgrade sentiment/anger detection from lexicon-based to a real NLP model.** The current
  `callAnalysisService.js` is genuinely functional but simple (keyword/heuristic based, runs
  locally with no external call). Swap in a real classifier once `LLM_PROVIDER` is configured.

## 4. Telephony (PSTN calls)
- The AMI/ESL/Twilio code is real and protocol-correct; what's missing is a live Asterisk/
  FreeSWITCH/Twilio account to point it at. Once you have one, set the matching `.env` vars and
  use the Superadmin "Test connection" button before placing a real call.
- Add **call retry/backoff and DND/compliance handling** (do-not-call lists, calling-hours
  restrictions per region) before dialing real numbers at scale.

## 5. Messaging
- **Email deliverability** — once live SMTP is configured, set up SPF/DKIM/DMARC for the sending
  domain so invite/result emails don't land in spam.
- **WhatsApp template approval** — the first outbound message in a new conversation window
  typically requires a Meta-approved message template, not free-form text; plan for that in the
  invite-send flow.

## 6. Meeting platform integrations
- ~~Mattermost~~ → done — set `MEETING_VENDOR=mattermost` + `MATTERMOST_URL/TEAM/CHANNEL_NAME`
  to point the interview room's "external meeting" link at a Mattermost channel with Calls
  enabled (see `src/services/mattermostService.js`).
- **Google Meet / Microsoft Teams** — still not built. To generate a real Meet/Teams link
  instead, call Google Calendar API (`conferenceData.createRequest`) or Microsoft Graph
  (`onlineMeetings`) when scheduling, and store the returned join URL on the
  `interviewSessions` doc.

## 7. Security & compliance
- **MFA recovery.** No self-service recovery-code flow exists — a Superadmin must disable MFA
  manually if a device is lost.
- **CAPTCHA on public endpoints** in addition to rate limiting, for extra abuse protection at
  scale.
- **Rotate `formToken`s** or add expiry — currently a candidate's token is valid indefinitely.
- **GDPR/DPDP-style data subject rights** — add candidate data export/delete endpoints if you
  operate in a jurisdiction that requires them, including deleting stored recordings.

## 8. Product gaps worth closing next
- **Resume-driven form auto-fill** — resume text is parsed for skill-matching, but doesn't yet
  auto-populate the pre-test's profile fields.
- **Scenario/case-based and file-upload question types** — the pre-test currently supports
  MCQ/free-text/Likert only; the original brief also called for scenario-based and portfolio
  upload questions.
- **Bulk candidate import (CSV)** instead of one-at-a-time creation.
- **Panel interviews** (more than one HR/Management participant in a room at once) — needs the
  SFU work in section 2 first.
- **Direct HRMS/ATS connectors** — today, integration is via the outbound webhook system and the
  REST API; a purpose-built connector for a specific HRMS (Workday, SAP SuccessFactors, etc.)
  would need to be built per-target-system.
