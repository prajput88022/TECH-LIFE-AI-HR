const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "tech-life-ai-hr-dev-secret-change-me";
const JWT_EXPIRES_IN = "12h";

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId || null,
      name: user.name,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Short-lived token issued after password check when MFA is enabled - proves the password
// was already correct, without granting a full session until the TOTP code is also verified.
function signMfaChallenge(user) {
  return jwt.sign({ sub: user.id, mfaPending: true }, JWT_SECRET, { expiresIn: "5m" });
}

function verifyMfaChallenge(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.mfaPending ? payload : null;
  } catch (e) {
    return null;
  }
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, signMfaChallenge, verifyMfaChallenge };
