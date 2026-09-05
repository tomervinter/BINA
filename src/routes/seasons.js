const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseDMY } = require('../lib/csv');

const router = express.Router();
router.use(requireAuth);

function toRow(r) {
  return {
    name: String(r['עונה'] || r.name || '').trim(),
    year: Number(r['שנה'] != null ? r['שנה'] : r.year) || 0,
    fromDate: parseDMY(r['מתאריך'] || r.fromDate) || new Date(0),
    toDate: parseDMY(r['עד תאריך'] || r.toDate) || new Date(0)
  };
}

router.get('/', async (req, res) => {
  const rows = await prisma.season.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ year: 'desc' }, { fromDate: 'asc' }]
  });
  res.json(rows);
});

// Rows are added blank and filled in via inline edits (PUT), so name isn't required here.
router.post('/', async (req, res) => {
  const data = toRow(req.body || {});
  const row = await prisma.season.create({ data: { ...data, organizationId: req.user.organizationId } });
  res.json(row);
});

router.put('/:id', async (req, res) => {
  const existing = await prisma.season.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!existing) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  const data = toRow(req.body || {});
  const row = await prisma.season.update({ where: { id: existing.id }, data });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const existing = await prisma.season.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!existing) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  await prisma.season.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

module.exports = router;
