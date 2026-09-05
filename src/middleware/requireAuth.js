const { verifyToken, TOKEN_COOKIE } = require('../lib/auth');

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[TOKEN_COOKIE];
  if (!token) return res.status(401).json({ error: 'לא מחובר' });
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'החיבור פג תוקף, יש להתחבר מחדש' });
  }
}

module.exports = requireAuth;
