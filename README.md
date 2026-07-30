# Tech-Life AI HR — Multi-Tenant AI HR Decision Intelligence Platform

A multi-tenant platform where a **Superadmin** provisions organizations ("tenants"), turns on
exactly the features each one is licensed for, and creates their **HR** / **Management** users.
Those users log in to their own workspace, add candidates or employees (for screening *or*
promotion review), and send them an invite by **email / WhatsApp / AI call**. The candidate
accepts the invite, optionally completes an industry-and-level-adaptive pre-test, and then joins
a live **WebRTC interview room** — conducted by a **human** if one is available, or automatically
by the **AI interviewer** (browser-based ASR + natural voice) if not. HR can join at any moment
and **take over from the AI** live. The final decision (select / hold / reject or promote) is
recorded with full audit history, and can optionally **email the result to the candidate**.

## Quick start

```bash
npm install
npm start
```

For a real CouchDB deployment and a full walkthrough of how logins/users work (Superadmin →
Organizations → HR/Management users → candidate invite links), see **`COUCHDB_SETUP.md`**.

Then open:
- Tenant/HR/Management login: **http://localhost:4000/index.html**
- Superadmin console: **http://localhost:4000/superadmin.html**

Seeded accounts (first run only):

| Role | Login |
|---|---|
| Superadmin | `superadmin@techlife.ai` / `SuperAdmin@123` |
| HR (Demo Corp, code `demo`) | `hr@demo.com` / `Demo@123` |
| Management (Demo Corp, code `demo`) | `management@demo.com` / `Demo@123` |

A sample candidate is seeded with an invite link printed to the console on first boot
(`/invite.html?token=...`) — open it in a second browser/incognito window to walk the whole
candidate journey while logged in as HR in your main window.

## How the pieces fit together

```
Superadmin ──creates──▶ Tenant (organization) ──has──▶ Feature toggles
                                │
                                ├──creates──▶ HR / Management users (mark themselves Available/Busy)
                                │
                                └──HR/Mgmt adds──▶ Candidate or Employee (screening or promotion case)
                                                        │
                                                sends invite (email / WhatsApp / AI call)
                                                        │
                                              candidate opens /invite.html
                                                        │
                                     pre-test (if enabled) ──▶ Interview Room
                                                        │
                                     ┌──────────────────┴───────────────────┐
                              a human is available              nobody is available
                                        │                                  │
                               Human-conducted interview          AI-conducted interview
                              (real WebRTC audio/video)     (browser TTS asks Qs, browser ASR
                                        │                     listens for answers, live transcript)
                                        │                                  │
                                        └──────HR can "Take over" anytime──┘
                                                        │
                                          HR records decision (select/hold/reject)
                                                        │
                                         optional result email to candidate/employee
```

## Data layer — CouchDB

`src/db.js` stores every record as a CouchDB document (`{ type: 'tenant' | 'user' | 'candidate' |
'interviewSession' | 'interviewTranscript' | 'integrationConfig' | ... }`) via **PouchDB**, which
speaks CouchDB's own replication protocol:

- **No `COUCHDB_URL` set (default):** documents are stored locally on disk in CouchDB's document
  format — zero external services needed to run the whole app.
- **`COUCHDB_URL` set:** every read/write goes straight to a real CouchDB (or Cloudant) database
  over HTTP, e.g.:
  ```bash
  docker run -d --name couchdb -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password couchdb
  COUCHDB_URL=http://admin:password@localhost:5984/techlifehr npm start
  ```
  You can also **replicate** the local embedded store into a real cluster at any time via
  `db.couch.replicate.to(new PouchDB(remoteUrl))`.

## Closing the remaining gaps — this version

- **Rate limiting on all public (unauthenticated) endpoints** — `src/middleware/rateLimit.js`,
  a dependency-free in-memory sliding-window limiter. Reads: 60/min per IP; writes (accept
  invite, submit pre-test, give consent): 12/min per IP. Verified: 13th write in a minute
  correctly returns `429`.
- **Real "Test connection" tooling on the Superadmin Integrations page** — one click, actual
  network calls, no guessing whether `.env` credentials are right:
  - Mail server → `nodemailer` `transporter.verify()` (real SMTP handshake + auth, no email sent)
  - WhatsApp → `GET /{phone_number_id}` against the Meta Graph API with your token
  - Telephony → Twilio account lookup, or a real Asterisk AMI / FreeSWITCH ESL login+logoff
  - Webhooks → a real signed `test.ping` POST to every configured `WEBHOOK_URLS` entry
- **More robust call recording** — a wider `MediaRecorder` codec fallback chain (including
  Safari's `video/mp4`), explicit user-facing status/error messages instead of silent
  failures, and upload-failure surfacing instead of a swallowed error.

## Closing the remaining gaps — this version

- **Chatwoot integration** — message candidates through a real Chatwoot conversation (visible
  to your whole HR team in Chatwoot's own agent inbox) as a 4th send channel alongside email/
  WhatsApp/call. Real Application API calls: contact lookup/create, conversation lookup/create,
  message send. Verified against a local server reproducing Chatwoot's documented API contract
  (`npm run verify:chatwoot`).
- **Mattermost integration** — real-time HR/ops alerts via a genuine Incoming Webhook (anger
  detected on a call, a case needs Management approval), plus an optional Mattermost-channel-as-
  meeting-room mode. Verified with a real payload-contract test (`npm run verify:mattermost`).
- **Every "real code, but unverifiable" integration from the previous version has now actually
  been verified against something real**, not just code-reviewed:
  - **Email** — verified against a real local SMTP server, full protocol handshake + delivery
    (`npm run verify:email`)
  - **Webhooks** — verified against a real local HTTP receiver with an independently
    recomputed HMAC-SHA256 signature (`npm run verify:webhook`)
  - **Asterisk AMI** — verified against a **real, locally-installed Asterisk 20 server**: real
    TCP socket, real Login/Originate/Logoff actions, and confirmed bad credentials are
    correctly rejected (`npm run verify:asterisk`)
  - **Twilio + WhatsApp Cloud API** — cloud-only services with no local install option, so
    verified against a local server reproducing their exact documented request/response
    contract (`npm run verify:twilio-whatsapp`)
  - See `tests/README.md` for exactly what each test proves and how to run it yourself
- **Rate limiting on all public (unauthenticated) endpoints** and **real "Test connection"
  buttons** on the Superadmin Integrations page (see previous section) remain in place.
- **`COUCHDB_SETUP.md`** — a complete walkthrough of setting up real CouchDB (Docker or native),
  and how the app's own login users (Superadmin → Organizations → HR/Management → candidate
  invite links) actually get created, step by step.

## What's new in this version — real-world integrations, call intelligence, and reports

- **No more mock mode.** Email (SMTP), WhatsApp (Meta Cloud API), and outbound calls (Twilio /
  Asterisk AMI / FreeSWITCH ESL) are real implementations. All credentials live in `.env` —
  never in the database — see `.env.sample`.
- **Real outbound webhooks**, HMAC-SHA256 signed, firing on `candidate.created`,
  `invite.accepted`, `pretest.submitted`, `interview.scheduled`, `interview.completed`,
  `decision.finalized`, and `candidate.auto_screened_out`. Configure `WEBHOOK_URLS` +
  `WEBHOOK_SECRET` in `.env`; delivery history is visible on the Reports page.
- **Aptitude / Personality / Communication assessment sections are now optional per candidate**
  — HR/Management chooses which to assign when adding a candidate (Technical & Behavioral
  always runs since it drives the AI interview itself).
- **WebRTC call recording** — every interview room session records local + remote audio (mixed
  via Web Audio) plus local video with `MediaRecorder`, uploaded and stored as a CouchDB
  attachment on the interview session.
- **Dial pad** with real `RTCDTMFSender` wiring — ready for bridging into a real telephony/IVR
  system.
- **Call analysis** — sentiment, anger detection, and diarization (per-speaker talk time) are
  computed automatically from every interview's transcript (`src/services/callAnalysisService.js`,
  local lexicon-based heuristics — no external AI call, see the note in that file).
- **Consent capture** — candidates must explicitly consent to recording/transcription before
  their interview room becomes usable.
- **Seniority-based approval routing** — HR cannot finalize decisions for GM/VP-level cases;
  only Management/Superadmin can.
- **Pass-threshold auto-screening** — optionally auto-reject candidates whose pre-test score
  falls below a configurable minimum, right after they submit.
- **A full Reports & Approvals page** (`/reports.html`) — searchable, filterable (date range,
  industry, level, case type, status, interview mode, decision, sentiment, anger-flagged-only,
  free-text search) case list, a Pending Approvals queue with inline decision recording, a
  Department Analytics view, and a Webhook Delivery Log — with CSV export respecting the
  active filters.

## Feature toggles (Superadmin → Organizations)

Each tenant gets its own on/off switches: Candidate Management, AI Voice Interview, Telephony
Calling, Pre-Test/Smart Form, Email Notifications, WhatsApp Notifications, KPI Analytics, Reports
Dashboard, Webhook/API. See `src/featureCatalog.js` to add a new one.

## KPI & Performance Analytics (promotion-readiness scoring)

When `kpi_analytics` is enabled for a tenant, HR/Management can, from a candidate/employee's
detail panel:
- **Import KPI review periods** (`POST /api/candidates/:id/kpi`) — one or more named metrics per
  period, each tagged `higher_is_better` (sales, CSAT, …) or `lower_is_better` (attrition, cost,
  defects, …) and normalized against its target.
- **View the KPI trend** (`GET /api/candidates/:id/kpi`) — a weighted, recency-favoring score plus
  an improving/declining/stable trend across the last up to 4 periods.
- **Set interview / pre-test scores** (`PATCH /api/candidates/:id/scores`, 0-100 each).
- **Get the blended promotion/hiring-readiness score** (`GET /api/candidates/:id/readiness-score`)
  — combines whatever of {KPI, interview, pre-test} is available, using tenant-configurable
  weights (`GET`/`PUT /api/scoring/weights`, default 40/40/20). Missing components have their
  weight redistributed rather than counted as zero. This score is always a **decision aid shown
  alongside the human decision**, never a substitute for it — the final select/hold/reject call
  in `POST /api/interviews/:id/decision` is still made and recorded by a person.

## Industry catalog (works across all industries, extensible)

`GET /api/meta/industries` and `GET /api/meta/levels` return the full, live catalog that both the
pre-test/AI-interview question engine and the "Add candidate" dropdowns are built from.
- **21 industries ship built-in** (`src/industryCatalog.js`): IT/ITES, BFSI, Manufacturing, Retail
  & E-commerce, Healthcare, Pharma & Life Sciences, Logistics, BPO, Education, Real Estate &
  Construction, Telecom, Media & Entertainment, Travel/Hospitality/Aviation, Energy & Utilities,
  Automotive, Agriculture, Government & Public Sector, Legal Services, Consulting, Non-Profit, and
  a general "Other" fallback.
- **Superadmin can add any additional industry at runtime** — no code change needed — from the
  Superadmin → Industries page, or via `POST /api/superadmin/industries { key, label,
  focusQuestion }`. It immediately becomes selectable for every tenant and is woven into that
  candidate's question set alongside their level-based questions.

## Vendor / integration configuration (Superadmin → Integrations)

`src/services/integrationService.js` is a schema-driven settings store for every pluggable vendor:

| Category | Works today, no keys | Real vendors you can wire in |
|---|---|---|
| LLM | — | Anthropic, OpenAI, custom endpoint |
| STT / ASR | Browser Web Speech API | Deepgram, Google STT, self-hosted Whisper, custom |
| TTS / natural voice | Browser Web Speech API | ElevenLabs, Azure TTS, Google TTS, custom |
| Bot / conversation engine | Built-in rules-based question flow | Rasa, Dialogflow, custom |
| Telephony | — | Asterisk (AMI), FreeSWITCH (ESL), Twilio |
| Meeting / video | Built-in WebRTC room | Google Meet, Microsoft Teams, custom |
| Mail server | — | SMTP (via nodemailer) |

Secrets are redacted before ever being sent to the browser. Wiring a real vendor is a matter of
filling in the corresponding `*Real()` function in `src/services/notifyService.js` (email/call) or
the room/AI logic (STT/TTS/LLM) — the config plumbing, forms, and storage are already there.

## What's genuinely live vs. what's a wired stub

**Fully working out of the box (no external accounts needed):**
- Multi-tenant auth, RBAC, feature toggles, CouchDB-backed storage
- Candidate/employee invite → pre-test → auto-scheduling (human vs AI) based on live HR
  availability
- Real 2-party WebRTC audio/video call (mic + camera) between candidate and HR, signaled over
  Socket.IO
- AI-conducted interview using the browser's native Speech Synthesis (voice) and Speech
  Recognition (ASR) — a real, working "AI voice interview" end to end
- Live transcript, HR "take over from AI" / "hand back to AI" controls
- Decision recording with optional candidate email (mock-delivered and logged when no SMTP is
  configured, so the whole flow is testable without real credentials)

**Stubbed and ready to wire (needs real credentials + outbound network access):**
- Real outbound telephony calls via Asterisk AMI / FreeSWITCH ESL / Twilio
- Real SMTP sending (nodemailer is wired — just fill in the Mail Server integration)
- Real WhatsApp delivery (Cloud API / Twilio)
- Swapping browser ASR/TTS for Deepgram/ElevenLabs/Azure/Google
- Google Meet / Microsoft Teams link creation via their calendar/meeting APIs
- A production Rasa/Dialogflow/LLM-backed conversation engine instead of the built-in rules-based
  question flow

See `RECOMMENDATIONS.md` for the full production-hardening checklist.

## Project layout

```
src/
  db.js                     CouchDB (PouchDB) data layer
  featureCatalog.js         Per-tenant feature toggle catalog
  seed.js                   First-run demo data
  server.js                 Express app + Socket.IO signaling server
  middleware/auth.js         JWT auth, role guard, feature guard
  services/
    authService.js           Password hashing / JWT
    activityService.js        Audit log writer
    notifyService.js          Email / WhatsApp / call dispatch (mock + real hooks)
    integrationService.js     Vendor/config schema + storage
    schedulingService.js      Human-vs-AI interview assignment
    formTemplates.js          Industry + level adaptive question bank
  routes/
    authRoutes.js, meRoutes.js, superadminRoutes.js, candidateRoutes.js,
    interviewRoutes.js, reportRoutes.js, publicRoutes.js
public/
  index.html, dashboard.html, superadmin.html   Logged-in consoles
  invite.html, apply.html, interview-room.html  Candidate-facing (token-based, no login)
  js/, style.css
```

## Environment variables

See `.env.example`. Copy it to `.env` and adjust as needed.
