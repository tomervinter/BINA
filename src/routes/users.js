const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const rows = await prisma.user.findMany({
    where: { organizationId: req.user.organizationId },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' }
  });
  res.json(rows);
});

router.post('/invite', requireAdmin, async (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'יש למלא אימייל וסיסמה' });
  if (String(password).length < 8) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' });
  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) return res.status(409).json({ error: 'כבר קיים משתמש עם אימייל זה' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: name || null,
      role: role === 'admin' ? 'admin' : 'member',
      organizationId: req.user.organizationId
    }
  });
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

router.put('/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (role !== 'admin' && role !== 'member') return res.status(400).json({ error: 'תפקיד לא תקין' });
  const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });
  await prisma.user.update({ where: { id: target.id }, data: { role } });
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.userId) return res.status(400).json({ error: 'לא ניתן להסיר את עצמך' });
  const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });
  await prisma.user.delete({ where: { id: target.id } });
  res.json({ ok: true });
});

module.exports = router;
