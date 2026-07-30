# Integration verification tests

These are **not** unit tests with mocked internals — each one exercises the platform's *real*
integration code (`src/services/notifyService.js`, `webhookService.js`,
`telephony/asteriskClient.js`) against something real: a real local SMTP server, a real local
HTTP receiver, a real local Asterisk PBX, or a server that reproduces the exact documented
request/response contract of a cloud API we can't reach from a sandboxed environment.

| Script | What it proves | How |
|---|---|---|
| `npm run verify:email` | Our SMTP integration genuinely sends a working email over the real SMTP protocol | Spins up a real local SMTP server (`smtp-server`), points `notifyService` at it via env vars, sends a real email through our real `sendEmail()`, and asserts the local server actually received the correct recipient/subject/body. |
| `npm run verify:webhook` | Our outbound webhook dispatch is a real, correctly HMAC-signed HTTP POST | Spins up a real local HTTP server, dispatches a real webhook through `webhookService.testPing()`, and **independently recomputes the HMAC-SHA256 signature** the way a receiving system would, confirming it matches. |
| `npm run verify:asterisk` | Our Asterisk AMI client speaks the real AMI protocol correctly | Requires a local Asterisk install (`apt-get install asterisk`, see below) — connects over a real TCP socket, does a real `Login` action, a real `Originate` action, and a real `Logoff`, all against actual Asterisk. Also proves bad credentials are correctly rejected. |
| `npm run verify:twilio-whatsapp` | Our Twilio and WhatsApp Cloud API request/response handling matches their real, documented API contract | Twilio and Meta's WhatsApp Cloud API are cloud-only services with no local install option, so this test redirects `api.twilio.com`/`graph.facebook.com` to a local HTTPS server (via `/etc/hosts`) that validates our requests match the real documented shape (exact paths, exact Basic/Bearer auth headers, exact required fields) and returns real-shaped responses. This proves our request construction and response parsing are spec-correct — it is **not** the same as a live call to Twilio/Meta, since no real account was involved. |

## Running the Asterisk test

```bash
sudo apt-get update && sudo apt-get install -y asterisk
sudo mkdir -p /etc/asterisk/manager.d
sudo tee /etc/asterisk/manager.d/techlife-test.conf <<'EOF'
[techlifetest]
secret = TestSecret123
read = system,call,agent,log,verbose,command,agi,user
write = system,call,agent,log,verbose,command,agi,user
EOF
sudo asterisk -U asterisk -G asterisk   # starts as a daemon
npm run verify:asterisk
sudo asterisk -rx "core stop now"       # stop it when done
```

## Running the Twilio/WhatsApp contract test

```bash
# One-time: redirect the two hostnames to localhost for this test
echo "127.0.0.1 api.twilio.com graph.facebook.com" | sudo tee -a /etc/hosts

npm run verify:twilio-whatsapp

# Clean up afterwards
sudo sed -i '/api.twilio.com graph.facebook.com/d' /etc/hosts
```

## What's still genuinely unverified

FreeSWITCH (no apt package available in a stock Ubuntu sandbox — its official repo requires a
SignalWire account as of 2024) and, obviously, a *live* Twilio/WhatsApp/Asterisk/FreeSWITCH
account with real credentials and real network access to the real cloud services. Everything
above proves the code is correct against the real protocol/contract; only a real account and a
network route to the real service can prove the very last mile.
