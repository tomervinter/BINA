const crypto = require('crypto');

// Used for both password-reset and email-verification tokens: the raw value goes
// out in the emailed link, only its SHA-256 hash is ever stored — same principle
// as passwordHash, so a database leak alone can't be used to reset an account.
function generateToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

module.exports = { generateToken, hashToken };
