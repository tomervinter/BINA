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

// Creates a brand-new organization (tenant) plus its first admin user.
router.post('/signup', async (req, res) => {
  const { organizationName, email, password, name } = req.body || {};
  if (!organizationName || !email || !password) {
    return res.status(400).json({ error: 'יש למלא שם חברה, אימייל וסיסמה' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
  }
  const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (existing) return res.status(409).json({ error: 'כבר קיים משתמש עם אימייל זה' });

  const passwordHash = await bcrypt.hash(password, 10);
  const org = await prisma.organization.create({ data: { name: organizationName } });
  const user = await prisma.user.create({
    data: {
      email: String(email).toLowerCase().trim(),
      passwordHash,
      name: name || null,
      role: 'admin',
      organizationId: org.id
    }
  });

  const token = signToken(user);
  res.cookie(TOKEN_COOKIE, token, COOKIE_OPTS);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, organization: { id: org.id, name: org.name } });
});

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
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, organization: { id: org.id, name: org.name } });
});

module.exports = router;
