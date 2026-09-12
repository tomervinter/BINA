const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer } = require('../lib/csv');
const { parseListQuery } = require('../lib/listQuery');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');
const { replaceAll } = require('../lib/bulkInsert');

const EXPORT_COLUMNS = [
  { key: 'customerNumber', label: 'מספר לקוח' },
  { key: 'name', label: 'שם לקוח' },
  { key: 'primaryClass', label: 'סיווג ראשי לקוח' },
  { key: 'customerType', label: 'סוג לקוח' },
  { key: 'city', label: 'עיר' },
  { key: 'centralCustomer', label: 'שם לקוח מרכז' },
  { key: 'status', label: 'סטטוס לקוח' }
];
const MAX_EXPORT_ROWS = 100000;

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

const LIST_FIELDS = ['customerNumber', 'name', 'primaryClass', 'customerType', 'city', 'centralCustomer', 'status'];

router.get('/', async (req, res) => {
  const { page, pageSize, sortBy, sortDir, where, skip, take } = parseListQuery(req, {
    sortableFields: LIST_FIELDS,
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'name', dir: 'asc' }
  });
  const fullWhere = { organizationId: req.user.organizationId, ...where };
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({ where: fullWhere, orderBy: { [sortBy]: sortDir }, skip, take }),
    prisma.customer.count({ where: fullWhere })
  ]);
  res.json({ rows, total, page, pageSize });
});

// Real .xlsx export honoring the same filters/sort as the list view (capped so a
// runaway export can't exhaust server memory at hundreds-of-thousands-of-rows scale).
router.get('/export', async (req, res) => {
  const { sortBy, sortDir, where } = parseListQuery(req, {
    sortableFields: LIST_FIELDS,
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'name', dir: 'asc' }
  });
  const rows = await prisma.customer.findMany({
    where: { organizationId: req.user.organizationId, ...where },
    orderBy: { [sortBy]: sortDir },
    take: MAX_EXPORT_ROWS
  });
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.xlsx"');
  res.send(buffer);
});

// Full-replace upload, matching the confirmed real-world workflow: each day's file
// is a fresh complete export, so it replaces everything rather than merging.
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });
  let records;
  try {
    records = parseFileBuffer(req.file.buffer, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ error: 'שגיאה בקריאת הקובץ — ודאו שזהו קובץ CSV או Excel תקין' });
  }
  if (!records.length) return res.status(400).json({ error: 'הקובץ ריק' });

  const orgId = req.user.organizationId;
  const rows = records.map((r) => ({
    organizationId: orgId,
    customerNumber: String(r['מספר לקוח'] || '').trim(),
    name: String(r['שם לקוח'] || '').trim(),
    primaryClass: r['סיווג ראשי לקוח'] || null,
    customerType: r['סוג לקוח'] || null,
    city: r['עיר'] || null,
    centralCustomer: r['שם לקוח מרכז'] || null,
    status: r['סטטוס לקוח'] || 'פעיל'
  })).filter((r) => r.customerNumber);

  await replaceAll(prisma, 'customer', { organizationId: orgId }, rows);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.customer.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
