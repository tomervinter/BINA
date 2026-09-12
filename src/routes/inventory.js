const express = require('express');
const multer = require('multer');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer, parseDMY, parseNumber } = require('../lib/csv');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');
const { replaceAll } = require('../lib/bulkInsert');
const { buildFilterClauses, parseRawListQuery } = require('../lib/rawFilter');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

const MAX_EXPORT_ROWS = 100000;

// Raw SQL (no join needed here, but stock/date aren't plain-text columns, so Prisma's
// simple `contains` string filter can't be used directly on them) — see src/lib/rawFilter.js.
const COLUMNS = {
  sku: { sql: 'i."sku"', type: 'text' },
  productName: { sql: 'i."productName"', type: 'text' },
  date: { sql: 'i."date"', type: 'year' },
  stock: { sql: 'i."stock"', type: 'number' }
};

const SELECT_SQL = Prisma.raw('i."sku" AS "sku", i."productName" AS "productName", i."date" AS "date", i."stock" AS "stock"');
const FROM_SQL = Prisma.raw('FROM "InventoryRecord" i');

function buildWhere(organizationId, filters) {
  const clauses = [Prisma.sql`i."organizationId" = ${organizationId}`, ...buildFilterClauses(COLUMNS, filters)];
  return Prisma.join(clauses, ' AND ');
}

function orderSqlFor(sortBy, sortDir) {
  return Prisma.raw(`${COLUMNS[sortBy].sql} ${sortDir}`);
}

function normalizeRow(r) {
  return { ...r, stock: Number(r.stock) || 0 };
}

function fmtDate(d) {
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + '/' + dt.getFullYear();
}
const EXPORT_COLUMNS = [
  { key: 'sku', label: 'מק"ט' },
  { key: 'productName', label: 'שם מוצר' },
  { key: 'date', label: 'תאריך', value: (r) => fmtDate(r.date) },
  { key: 'stock', label: 'מלאי' }
];

router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const { page, pageSize, filters, sortBy, sortDir } = parseRawListQuery(req, COLUMNS, 'date');
  const whereSql = buildWhere(organizationId, filters);
  const orderSql = orderSqlFor(sortBy, sortDir);
  const skip = (page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`SELECT ${SELECT_SQL} ${FROM_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${skip}`,
    prisma.$queryRaw`SELECT COUNT(*) AS "count" ${FROM_SQL} WHERE ${whereSql}`
  ]);
  res.json({ rows: rows.map(normalizeRow), total: Number(countRows[0].count), page, pageSize });
});

router.get('/export', async (req, res) => {
  const organizationId = req.user.organizationId;
  const { filters, sortBy, sortDir } = parseRawListQuery(req, COLUMNS, 'date');
  const whereSql = buildWhere(organizationId, filters);
  const orderSql = orderSqlFor(sortBy, sortDir);
  const rawRows = await prisma.$queryRaw`SELECT ${SELECT_SQL} ${FROM_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${MAX_EXPORT_ROWS}`;
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rawRows.map(normalizeRow));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory.xlsx"');
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

  await replaceAll(prisma, 'inventoryRecord', { organizationId: orgId }, rows);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.inventoryRecord.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
