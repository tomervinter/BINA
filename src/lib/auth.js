const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_COOKIE = 'radar_token';
const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign(
    { userId: user.id, organizationId: user.organizationId, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken, TOKEN_COOKIE };
