const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

// Effective column order for the current user on a given table: their own saved
// order, else the organization admin's saved order (the "default" a reset reverts
// to), else null — meaning the page should just use its own hardcoded column order.
router.get('/:tableKey', async (req, res) => {
  const { tableKey } = req.params;
  const organizationId = req.user.organizationId;

  const mine = await prisma.columnOrder.findUnique({
    where: { userId_tableKey: { userId: req.user.userId, tableKey } }
  });
  if (mine) return res.json({ order: JSON.parse(mine.order), isDefault: false });

  const admin = await prisma.user.findFirst({ where: { organizationId, role: 'admin' }, orderBy: { createdAt: 'asc' } });
  if (admin) {
    const adminOrder = await prisma.columnOrder.findUnique({
      where: { userId_tableKey: { userId: admin.id, tableKey } }
    });
    if (adminOrder) return res.json({ order: JSON.parse(adminOrder.order), isDefault: true });
  }

  res.json({ order: null, isDefault: true });
});

router.put('/:tableKey', async (req, res) => {
  const { tableKey } = req.params;
  const order = (req.body || {}).order;
  if (!Array.isArray(order) || !order.every((k) => typeof k === 'string')) {
    return res.status(400).json({ error: 'סדר עמודות לא תקין' });
  }
  await prisma.columnOrder.upsert({
    where: { userId_tableKey: { userId: req.user.userId, tableKey } },
    update: { order: JSON.stringify(order) },
    create: { organizationId: req.user.organizationId, userId: req.user.userId, tableKey, order: JSON.stringify(order) }
  });
  res.json({ ok: true });
});

// Reset to the admin's default (or the page's hardcoded order, if the admin never set one).
router.delete('/:tableKey', async (req, res) => {
  await prisma.columnOrder.deleteMany({ where: { userId: req.user.userId, tableKey: req.params.tableKey } });
  res.json({ ok: true });
});

module.exports = router;
