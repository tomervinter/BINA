const express = require('express');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer, parseNumber } = require('../lib/csv');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');
const { replaceAll } = require('../lib/bulkInsert');
const { createJob, updateJob } = require('../lib/uploadJobs');
const { logAction } = require('../lib/auditLog');
const { buildFilterClauses, parseRawListQuery } = require('../lib/rawFilter');
const upload = require('../lib/uploadMiddleware');

const router = express.Router();

router.use(requireAuth);

const MAX_EXPORT_ROWS = 100000;

// A real SQL LEFT JOIN (not the in-JS per-page join used elsewhere) so every column —
// including the customer/product names, and the numeric/date ones — is sortable and
// filterable at the database level, not just customerNumber/productCode.
const COLUMNS = {
  customerNumber: { sql: 's."customerNumber"', type: 'text' },
  customerName: { sql: 'c."name"', type: 'text' },
  productCode: { sql: 's."productCode"', type: 'text' },
  productName: { sql: 'p."name"', type: 'text' },
  year: { sql: 's."date"', type: 'year' },
  month: { sql: 's."date"', type: 'month' },
  revenue: { sql: 's."revenue"', type: 'number' },
  quantity: { sql: 's."quantity"', type: 'number' },
  weight: { sql: 's."weight"', type: 'number' }
};

const SELECT_SQL = Prisma.raw(`
  s."customerNumber" AS "customerNumber", c."name" AS "customerName",
  s."productCode" AS "productCode", p."name" AS "productName",
  s."date" AS "date", s."revenue" AS "revenue", s."quantity" AS "quantity", s."weight" AS "weight"
`);

const JOIN_SQL = Prisma.raw(`
  FROM "Sale" s
  LEFT JOIN "Customer" c ON c."organizationId" = s."organizationId" AND c."customerNumber" = s."customerNumber"
  LEFT JOIN "Product" p ON p."organizationId" = s."organizationId" AND p."itemCode" = s."productCode"
`);

function buildWhere(organizationId, filters) {
  const clauses = [Prisma.sql`s."organizationId" = ${organizationId}`, ...buildFilterClauses(COLUMNS, filters)];
  return Prisma.join(clauses, ' AND ');
}

function orderSqlFor(sortBy, sortDir) {
  const colSql = sortBy === 'date' ? 's."date"' : COLUMNS[sortBy].sql;
  return Prisma.raw(`${colSql} ${sortDir}`);
}

function normalizeRow(r) {
  return { ...r, revenue: Number(r.revenue) || 0, quantity: Number(r.quantity) || 0, weight: r.weight == null ? null : Number(r.weight) };
}

router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const { page, pageSize, filters, sortBy, sortDir } = parseRawListQuery(req, COLUMNS, 'date');
  const whereSql = buildWhere(organizationId, filters);
  const orderSql = orderSqlFor(sortBy, sortDir);
  const skip = (page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`SELECT ${SELECT_SQL} ${JOIN_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${skip}`,
    prisma.$queryRaw`SELECT COUNT(*) AS "count" ${JOIN_SQL} WHERE ${whereSql}`
  ]);
  res.json({ rows: rows.map(normalizeRow), total: Number(countRows[0].count), page, pageSize });
});

router.get('/export', async (req, res) => {
  const organizationId = req.user.organizationId;
  const { filters, sortBy, sortDir } = parseRawListQuery(req, COLUMNS, 'date');
  const whereSql = buildWhere(organizationId, filters);
  const orderSql = orderSqlFor(sortBy, sortDir);

  const rawRows = await prisma.$queryRaw`SELECT ${SELECT_SQL} ${JOIN_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${MAX_EXPORT_ROWS}`;
  const rows = rawRows.map(normalizeRow);

  const exportColumns = [
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'customerName', label: 'שם לקוח' },
    { key: 'productCode', label: 'קוד פריט' },
    { key: 'productName', label: 'שם פריט' },
    { key: 'year', label: 'שנה', value: (r) => new Date(r.date).getFullYear() },
    { key: 'month', label: 'חודש', value: (r) => new Date(r.date).getMonth() + 1 },
    { key: 'revenue', label: 'מכר כספי' },
    { key: 'quantity', label: 'מכר כמותי' },
    { key: 'weight', label: 'משקל' }
  ];
  const buffer = rowsToXlsxBuffer(exportColumns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sales.xlsx"');
  res.send(buffer);
});

router.post('/upload', upload.single('file'), async (req, res) => {
  const t0 = Date.now();
  console.log('[upload] sales: request handler entered, file received,', req.file ? req.file.size + ' bytes' : 'no file');
  if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });

  const orgId = req.user.organizationId;
  const jobId = createJob(orgId);
  res.json({ jobId });

  // Parsing a large xlsx is itself real CPU-bound work — timed and run here in the
  // background alongside the DB write (not just the DB write, as before), so the
  // HTTP response never waits on ANY of it. See lib/uploadJobs.js.
  (async () => {
    let records;
    try {
      records = parseFileBuffer(req.file.buffer, req.file.originalname);
      console.log('[upload] sales: parsed', records.length, 'records in', Date.now() - t0, 'ms since handler entry');
    } catch (err) {
      updateJob(jobId, { status: 'error', error: 'שגיאה בקריאת הקובץ — ודאו שזהו קובץ CSV או Excel תקין' });
      return;
    }
    if (!records.length) {
      updateJob(jobId, { status: 'error', error: 'הקובץ ריק' });
      return;
    }

    const rows = records.map((r) => {
      const year = parseInt(r['שנה'], 10);
      const month = parseInt(r['חודש'], 10);
      const validPeriod = year > 1900 && month >= 1 && month <= 12;
      return {
        organizationId: orgId,
        customerNumber: String(r['מספר לקוח'] || '').trim(),
        productCode: String(r['קוד פריט'] || '').trim(),
        // Sales are now recorded at month granularity only (no exact day) — stored as the
        // 1st of the month so existing day/week-based Date math keeps working unmodified.
        date: validPeriod ? new Date(year, month - 1, 1) : null,
        quantity: parseNumber(r['מכר כמותי']),
        revenue: parseNumber(r['מכר כספי']),
        weight: r['משקל'] != null ? parseNumber(r['משקל']) : null
      };
    }).filter((r) => r.customerNumber && r.productCode && r.date);

    logAction(req.user, 'sale.upload', rows.length + ' שורות');
    try {
      await replaceAll(prisma, 'sale', { organizationId: orgId }, rows);
      console.log('[upload] sales: DB write done,', rows.length, 'rows,', Date.now() - t0, 'ms since handler entry');
      updateJob(jobId, { status: 'done', count: rows.length });
    } catch (err) {
      console.error('Sales upload job failed:', jobId, err);
      updateJob(jobId, { status: 'error', error: 'שגיאה בשמירת הנתונים בבסיס הנתונים — נסו שוב או פנו לתמיכה' });
    }
  })();
});

router.delete('/', async (req, res) => {
  await prisma.sale.deleteMany({ where: { organizationId: req.user.organizationId } });
  logAction(req.user, 'sale.delete_all');
  res.json({ ok: true });
});

module.exports = router;
