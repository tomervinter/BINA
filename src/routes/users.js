const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');
const attachSuperAdmin = require('../middleware/attachSuperAdmin');
const { generateToken } = require('../lib/tokens');
const { sendEmail } = require('../lib/email');
const { logAction } = require('../lib/auditLog');

const router = express.Router();
const VERIFY_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function appUrl() {
  return process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 4000);
}
router.use(requireAuth);
router.use(attachSuperAdmin);

// A super-admin sees and manages users across every organization, not just their
// own — everyone else stays scoped to req.user.organizationId exactly as before.
router.get('/', async (req, res) => {
  const where = req.isSuperAdmin ? {} : { organizationId: req.user.organizationId };
  const rows = await prisma.user.findMany({
    where,
    select: {
      id: true, email: true, name: true, role: true, isSuperAdmin: true,
      organizationId: true, createdAt: true, organization: { select: { name: true } }
    },
    orderBy: { createdAt: 'asc' }
  });
  res.json(rows.map((r) => ({
    id: r.id, email: r.email, name: r.name, role: r.role, isSuperAdmin: r.isSuperAdmin,
    organizationId: r.organizationId, organizationName: r.organization.name, createdAt: r.createdAt
  })));
});

router.post('/invite', requireAdmin, async (req, res) => {
  const { email, password, name, role, organizationId } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'יש למלא אימייל וסיסמה' });
  if (String(password).length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) return res.status(409).json({ error: 'כבר קיים משתמש עם אימייל זה' });

  // Only a super-admin may target a company other than their own — everyone else's
  // explicit organizationId (if somehow sent) is ignored in favor of their own.
  let targetOrgId = req.user.organizationId;
  if (req.isSuperAdmin && organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return res.status(400).json({ error: 'חברה לא נמצאה' });
    targetOrgId = organizationId;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { raw, hash } = generateToken();
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: name || null,
      role: role === 'admin' ? 'admin' : 'member',
      organizationId: targetOrgId,
      emailVerified: false,
      emailVerifyTokenHash: hash,
      emailVerifyExpiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS)
    }
  });
  const link = appUrl() + '/verify-email.html?token=' + raw;
  sendEmail({
    to: user.email,
    subject: 'ברוכים הבאים ל-BINA — אימות כתובת מייל',
    html: '<p>נוצר עבורכם חשבון ב-BINA.</p><p>לחצו כדי לאמת את כתובת המייל שלכם:</p><p><a href="' + link + '">אימות מייל</a></p>'
  }).catch((err) => console.error('Failed to send invite verification email:', err));
  // Logged against the TARGET org (not the inviter's own, which can differ when a
  // super-admin invites into another company) so that company's own audit log shows it.
  logAction({ organizationId: targetOrgId, userId: req.user.userId, email: req.user.email }, 'user.invite', normalizedEmail);
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId });
});

router.put('/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (role !== 'admin' && role !== 'member') return res.status(400).json({ error: 'תפקיד לא תקין' });
  const where = req.isSuperAdmin ? { id: req.params.id } : { id: req.params.id, organizationId: req.user.organizationId };
  const target = await prisma.user.findFirst({ where });
  if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });
  await prisma.user.update({ where: { id: target.id }, data: { role } });
  logAction({ organizationId: target.organizationId, userId: req.user.userId, email: req.user.email }, 'user.role_change', target.email + ' -> ' + role);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.userId) return res.status(400).json({ error: 'לא ניתן להסיר את עצמך' });
  const where = req.isSuperAdmin ? { id: req.params.id } : { id: req.params.id, organizationId: req.user.organizationId };
  const target = await prisma.user.findFirst({ where });
  if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });
  await prisma.user.delete({ where: { id: target.id } });
  logAction({ organizationId: target.organizationId, userId: req.user.userId, email: req.user.email }, 'user.delete', target.email);
  res.json({ ok: true });
});

// One-time bootstrap: usable only while the system has NO super-admin yet, so the
// very first one can be granted through the UI by any existing company admin,
// without anyone ever needing direct database access. Once one exists, only an
// existing super-admin can grant it to someone else (not exposed here — deliberately
// no self-service path beyond this single bootstrap moment).
router.post('/bootstrap-superadmin', requireAdmin, async (req, res) => {
  const existingCount = await prisma.user.count({ where: { isSuperAdmin: true } });
  if (existingCount > 0) return res.status(403).json({ error: 'כבר קיים מנהל-על במערכת — יש לפנות אליו לקבלת הרשאה.' });
  await prisma.user.update({ where: { id: req.user.userId }, data: { isSuperAdmin: true } });
  res.json({ ok: true });
});

module.exports = router;
