const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { signToken, TOKEN_COOKIE } = require('../lib/auth');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// Public self-service signup (anyone could create their own organization) has been
// removed on purpose: creating a company is now exclusively a super-admin action
// (POST /api/organizations), who then invites that company's first user into it via
// POST /api/users/invite — see organizations.js/users.js. Anything hitting this old
// path now gets a real 404 rather than silently doing nothing.

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'יש למלא אימייל וסיסמה' });

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (!user) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });

  const token = signToken(user);
  res.cookie(TOKEN_COOKIE, token, COOKIE_OPTS);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

router.post('/logout', (req, res) => {
  res.clearCookie(TOKEN_COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  const org = await prisma.organization.findUnique({ where: { id: req.user.organizationId } });
  if (!user || !org) return res.status(404).json({ error: 'משתמש לא נמצא' });
  // superAdminExists lets the UI decide whether to offer the one-time
  // bootstrap-superadmin self-promotion (see users.js) — only ever relevant while
  // it's still false.
  const superAdminCount = await prisma.user.count({ where: { isSuperAdmin: true } });
  res.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    organization: { id: org.id, name: org.name },
    superAdminExists: superAdminCount > 0
  });
});

module.exports = router;
