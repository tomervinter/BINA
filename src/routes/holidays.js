const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseDMY } = require('../lib/csv');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');

function fmtDate(d) {
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + '/' + dt.getFullYear();
}
const EXPORT_COLUMNS = [
  { key: 'name', label: 'חג' },
  { key: 'year', label: 'שנה' },
  { key: 'fromDate', label: 'מתאריך', value: (r) => fmtDate(r.fromDate) },
  { key: 'toDate', label: 'עד תאריך', value: (r) => fmtDate(r.toDate) },
  { key: 'daysBefore', label: 'מספר ימי השפעה לפני החג' },
  { key: 'daysAfter', label: 'מספר ימי השפעה לאחר החג' }
];

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

router.get('/export', async (req, res) => {
  const rows = await prisma.holiday.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ year: 'desc' }, { fromDate: 'asc' }]
  });
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="holidays.xlsx"');
  res.send(buffer);
});

router.delete('/', async (req, res) => {
  await prisma.holiday.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
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
