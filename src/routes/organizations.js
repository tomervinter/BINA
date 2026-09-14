const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');

const router = express.Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

router.get('/', async (req, res) => {
  const rows = await prisma.organization.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { users: true, customers: true } } }
  });
  res.json(rows.map((o) => ({
    id: o.id, name: o.name, createdAt: o.createdAt,
    userCount: o._count.users, customerCount: o._count.customers
  })));
});

router.post('/', async (req, res) => {
  const trimmed = String((req.body || {}).name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'יש להזין שם חברה' });
  const org = await prisma.organization.create({ data: { name: trimmed } });
  res.json(org);
});

module.exports = router;
