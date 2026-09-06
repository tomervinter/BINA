const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer } = require('../lib/csv');
const { parseListQuery } = require('../lib/listQuery');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');
const { replaceAll } = require('../lib/bulkInsert');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

const LIST_FIELDS = ['itemCode', 'name', 'type', 'superType', 'department', 'unit', 'status', 'forProcurement', 'forMarketing'];
const EXPORT_COLUMNS = [
  { key: 'itemCode', label: 'קוד פריט' },
  { key: 'name', label: 'שם פריט' },
  { key: 'type', label: 'טיפוס' },
  { key: 'superType', label: 'טיפוס על' },
  { key: 'department', label: 'מחלקה' },
  { key: 'unit', label: 'יחידת מידה למוצר' },
  { key: 'status', label: 'סטטוס מוצר' },
  { key: 'forProcurement', label: 'לעיתוד' },
  { key: 'forMarketing', label: 'לשיווק' }
];
const MAX_EXPORT_ROWS = 100000;

router.get('/', async (req, res) => {
  const { page, pageSize, sortBy, sortDir, where, skip, take } = parseListQuery(req, {
    sortableFields: LIST_FIELDS,
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'name', dir: 'asc' }
  });
  const fullWhere = { organizationId: req.user.organizationId, ...where };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where: fullWhere, orderBy: { [sortBy]: sortDir }, skip, take }),
    prisma.product.count({ where: fullWhere })
  ]);
  res.json({ rows, total, page, pageSize });
});

router.get('/export', async (req, res) => {
  const { sortBy, sortDir, where } = parseListQuery(req, {
    sortableFields: LIST_FIELDS,
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'name', dir: 'asc' }
  });
  const rows = await prisma.product.findMany({
    where: { organizationId: req.user.organizationId, ...where },
    orderBy: { [sortBy]: sortDir },
    take: MAX_EXPORT_ROWS
  });
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
  res.send(buffer);
});

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
    itemCode: String(r['קוד פריט'] || '').trim(),
    name: String(r['שם פריט'] || '').trim(),
    type: r['טיפוס'] || null,
    superType: r['טיפוס על'] || null,
    department: r['מחלקה'] || null,
    unit: r['יחידת מידה למוצר'] || null,
    status: r['סטטוס מוצר'] || 'פעיל',
    forProcurement: r['לעיתוד'] || null,
    forMarketing: r['לשיווק'] || null
  })).filter((r) => r.itemCode);

  await replaceAll(prisma, 'product', { organizationId: orgId }, rows);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.product.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
