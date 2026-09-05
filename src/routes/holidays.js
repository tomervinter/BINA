const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseDMY } = require('../lib/csv');

const router = express.Router();
router.use(requireAuth);

function toRow(r) {
  return {
    name: String(r['חג'] || r.name || '').trim(),
    year: Number(r['שנה'] != null ? r['שנה'] : r.year) || 0,
    fromDate: parseDMY(r['מתאריך'] || r.fromDate) || new Date(0),
    toDate: parseDMY(r['עד תאריך'] || r.toDate) || new Date(0),
    daysBefore: Number(r['מספר ימי השפעה לפני החג'] != null ? r['מספר ימי השפעה לפני החג'] : r.daysBefore) || 0,
    daysAfter: Number(r['מספר ימי השפעה לאחר החג'] != null ? r['מספר ימי השפעה לאחר החג'] : r.daysAfter) || 0
  };
}

router.get('/', async (req, res) => {
  const rows = await prisma.holiday.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ year: 'desc' }, { fromDate: 'asc' }]
  });
  res.json(rows);
});

// Rows are added blank and filled in via inline edits (PUT), so name isn't required here.
router.post('/', async (req, res) => {
  const data = toRow(req.body || {});
  const row = await prisma.holiday.create({ data: { ...data, organizationId: req.user.organizationId } });
  res.json(row);
});

router.put('/:id', async (req, res) => {
  const existing = await prisma.holiday.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!existing) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  const data = toRow(req.body || {});
  const row = await prisma.holiday.update({ where: { id: existing.id }, data });
  res.json(row);
});

router.delete('/:id', async (req, res) => {
  const existing = await prisma.holiday.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!existing) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  await prisma.holiday.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

module.exports = router;
