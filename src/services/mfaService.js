// TOTP (RFC 6238) two-factor authentication, implemented directly on Node's built-in `crypto`
// module - no third-party auth library dependency/version churn to worry about. Compatible
// with any standard authenticator app (Google Authenticator, Authy, 1Password, etc).

const crypto = require("crypto");
const QRCode = require("qrcode");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // allow ±1 time-step (±30s) of clock drift

function base32Encode(buffer) {
  let bits = "";
  buffer.forEach((byte) => { bits += byte.toString(2).padStart(8, "0"); });
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function keyUri(email, secret) {
  const issuer = "Tech-Life AI HR";
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

async function generateQrDataUrl(otpauthUri) {
  return QRCode.toDataURL(otpauthUri);
}

function totpAt(secret, counter) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0");
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const clean = String(token).trim();
  const currentStep = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let errorWindow = -WINDOW; errorWindow <= WINDOW; errorWindow++) {
    if (totpAt(secret, currentStep + errorWindow) === clean) return true;
  }
  return false;
}

module.exports = { generateSecret, keyUri, generateQrDataUrl, verifyToken };
