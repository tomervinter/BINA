const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { signToken, TOKEN_COOKIE } = require('../lib/auth');
const requireAuth = require('../middleware/requireAuth');
const { generateToken, hashToken } = require('../lib/tokens');
const { sendEmail } = require('../lib/email');

const router = express.Router();

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function appUrl() {
  return process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 4000);
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  // Only HTTPS in production — local dev serves plain http://localhost, where a
  // secure cookie would silently never be sent back, breaking local login.
  secure: process.env.NODE_ENV === 'production',
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

// Always responds the same way whether or not the email exists — otherwise this
// endpoint could be used to enumerate which addresses are registered.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'יש למלא אימייל' });
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (user) {
    const { raw, hash } = generateToken();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) }
    });
    const link = appUrl() + '/reset-password.html?token=' + raw;
    sendEmail({
      to: user.email,
      subject: 'איפוס סיסמה — BINA',
      html: '<p>התקבלה בקשה לאיפוס הסיסמה שלכם ב-BINA.</p><p><a href="' + link + '">לחצו כאן לאיפוס הסיסמה</a></p><p>הקישור תקף ל-30 דקות. אם לא ביקשתם זאת, אפשר להתעלם מהודעה זו.</p>'
    }).catch((err) => console.error('Failed to send password-reset email:', err));
  }
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'חסרים פרטים' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
  const user = await prisma.user.findUnique({ where: { passwordResetTokenHash: hashToken(token) } });
  if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    return res.status(400).json({ error: 'הקישור לא תקין או שפג תוקפו — יש לבקש קישור חדש' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null }
  });
  res.json({ ok: true });
});

router.get('/verify-email', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'קישור לא תקין' });
  const user = await prisma.user.findUnique({ where: { emailVerifyTokenHash: hashToken(token) } });
  if (!user || !user.emailVerifyExpiresAt || user.emailVerifyExpiresAt < new Date()) {
    return res.status(400).json({ error: 'קישור האימות לא תקין או שפג תוקפו — ניתן לבקש קישור חדש מתוך המערכת' });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyTokenHash: null, emailVerifyExpiresAt: null }
  });
  res.json({ ok: true });
});

router.post('/resend-verification', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  const { raw, hash } = generateToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifyTokenHash: hash, emailVerifyExpiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) }
  });
  const link = appUrl() + '/verify-email.html?token=' + raw;
  sendEmail({
    to: user.email,
    subject: 'אימות כתובת מייל — BINA',
    html: '<p>לחצו כדי לאמת את כתובת המייל שלכם ב-BINA:</p><p><a href="' + link + '">אימות מייל</a></p>'
  }).catch((err) => console.error('Failed to send verification email:', err));
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
    user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin, emailVerified: user.emailVerified },
    organization: { id: org.id, name: org.name },
    superAdminExists: superAdminCount > 0
  });
});

module.exports = router;
