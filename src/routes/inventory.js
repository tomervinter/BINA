const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer, parseDMY, parseNumber } = require('../lib/csv');
const { parseListQuery } = require('../lib/listQuery');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { page, pageSize, sortBy, sortDir, where, skip, take } = parseListQuery(req, {
    sortableFields: ['sku', 'productName', 'date', 'stock'],
    filterableFields: ['sku', 'productName'],
    defaultSort: { field: 'date', dir: 'desc' }
  });
  const fullWhere = { organizationId: req.user.organizationId, ...where };
  const [rows, total] = await Promise.all([
    prisma.inventoryRecord.findMany({ where: fullWhere, orderBy: { [sortBy]: sortDir }, skip, take }),
    prisma.inventoryRecord.count({ where: fullWhere })
  ]);
  res.json({ rows, total, page, pageSize });
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
  const rows = records.map((r) => {
    const date = parseDMY(r['תאריך']);
    return {
      organizationId: orgId,
      sku: String(r['מק"ט'] || r['מק״ט'] || '').trim(),
      productName: r['שם מוצר'] || null,
      date: date || new Date(0),
      stock: parseNumber(r['מלאי'])
    };
  }).filter((r) => r.sku);

  await prisma.$transaction([
    prisma.inventoryRecord.deleteMany({ where: { organizationId: orgId } }),
    prisma.inventoryRecord.createMany({ data: rows })
  ]);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.inventoryRecord.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
