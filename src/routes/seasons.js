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
  { key: 'name', label: 'עונה' },
  { key: 'year', label: 'שנה' },
  { key: 'fromDate', label: 'מתאריך', value: (r) => fmtDate(r.fromDate) },
  { key: 'toDate', label: 'עד תאריך', value: (r) => fmtDate(r.toDate) }
];

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

router.get('/export', async (req, res) => {
  const rows = await prisma.season.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ year: 'desc' }, { fromDate: 'asc' }]
  });
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="seasons.xlsx"');
  res.send(buffer);
});

router.delete('/', async (req, res) => {
  await prisma.season.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
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
