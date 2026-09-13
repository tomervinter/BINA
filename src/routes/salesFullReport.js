const express = require('express');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');
const { isPostgres } = require('../lib/dbProvider');

const router = express.Router();
router.use(requireAuth);

const MAX_EXPORT_ROWS = 100000;

// Every column, sortable and filterable, backed by a real SQL LEFT JOIN against the
// customer/product master tables (matched on organizationId + code, same as every other
// join in this app — there's no Prisma relation between Sale and Customer/Product because
// sales can reference a code before or after a master re-upload). A real join — rather than
// the in-JS per-page join used elsewhere — is required here because sort/filter must apply
// BEFORE pagination, and that can't be done correctly in memory at hundreds-of-thousands-of-rows scale.
// Only server-defined SQL fragments ever reach Prisma.raw; every user-supplied value is
// passed as a normal template value, which Prisma.sql parameterizes safely.
const COLUMNS = {
  customerNumber: { sql: 's."customerNumber"', type: 'text' },
  customerName: { sql: 'c."name"', type: 'text' },
  primaryClass: { sql: 'c."primaryClass"', type: 'text' },
  customerType: { sql: 'c."customerType"', type: 'text' },
  city: { sql: 'c."city"', type: 'text' },
  centralCustomer: { sql: 'c."centralCustomer"', type: 'text' },
  customerStatus: { sql: 'c."status"', type: 'text' },
  productCode: { sql: 's."productCode"', type: 'text' },
  productName: { sql: 'p."name"', type: 'text' },
  type: { sql: 'p."type"', type: 'text' },
  superType: { sql: 'p."superType"', type: 'text' },
  department: { sql: 'p."department"', type: 'text' },
  unit: { sql: 'p."unit"', type: 'text' },
  productStatus: { sql: 'p."status"', type: 'text' },
  forProcurement: { sql: 'p."forProcurement"', type: 'text' },
  forMarketing: { sql: 'p."forMarketing"', type: 'text' },
  year: { sql: 's."date"', type: 'year' },
  month: { sql: 's."date"', type: 'month' },
  revenue: { sql: 's."revenue"', type: 'number' },
  quantity: { sql: 's."quantity"', type: 'number' },
  weight: { sql: 's."weight"', type: 'number' }
};

const SELECT_SQL = Prisma.raw(`
  s."customerNumber" AS "customerNumber", c."name" AS "customerName", c."primaryClass" AS "primaryClass",
  c."customerType" AS "customerType", c."city" AS "city", c."centralCustomer" AS "centralCustomer",
  c."status" AS "customerStatus", s."productCode" AS "productCode", p."name" AS "productName",
  p."type" AS "type", p."superType" AS "superType", p."department" AS "department", p."unit" AS "unit",
  p."status" AS "productStatus", p."forProcurement" AS "forProcurement", p."forMarketing" AS "forMarketing",
  s."date" AS "date", s."revenue" AS "revenue", s."quantity" AS "quantity", s."weight" AS "weight"
`);

const JOIN_SQL = Prisma.raw(`
  FROM "Sale" s
  LEFT JOIN "Customer" c ON c."organizationId" = s."organizationId" AND c."customerNumber" = s."customerNumber"
  LEFT JOIN "Product" p ON p."organizationId" = s."organizationId" AND p."itemCode" = s."productCode"
`);

function monthSqlExpr() {
  // Prisma stores SQLite DateTime columns as a millisecond Unix-epoch integer, not
  // an ISO-8601 string — strftime() only recognizes a bare integer as a valid time
  // value with the 'unixepoch' modifier, and that modifier expects seconds, hence /1000.
  return isPostgres()
    ? Prisma.raw('EXTRACT(MONTH FROM s."date")::int')
    : Prisma.raw('CAST(strftime(\'%m\', s."date" / 1000, \'unixepoch\') AS INTEGER)');
}

function buildWhere(organizationId, filters) {
  const clauses = [Prisma.sql`s."organizationId" = ${organizationId}`];
  Object.keys(filters || {}).forEach((key) => {
    const col = COLUMNS[key];
    const value = String(filters[key] == null ? '' : filters[key]).trim();
    if (!col || !value) return;
    if (col.type === 'text') {
      clauses.push(Prisma.sql`LOWER(COALESCE(${Prisma.raw(col.sql)}, '')) LIKE LOWER(${'%' + value + '%'})`);
    } else if (col.type === 'number') {
      clauses.push(Prisma.sql`CAST(${Prisma.raw(col.sql)} AS TEXT) LIKE ${'%' + value + '%'}`);
    } else if (col.type === 'year') {
      const y = parseInt(value, 10);
      if (!isNaN(y)) clauses.push(Prisma.sql`s."date" >= ${new Date(y, 0, 1)} AND s."date" < ${new Date(y + 1, 0, 1)}`);
    } else if (col.type === 'month') {
      const m = parseInt(value, 10);
      if (!isNaN(m) && m >= 1 && m <= 12) clauses.push(Prisma.sql`${monthSqlExpr()} = ${m}`);
    }
  });
  return Prisma.join(clauses, ' AND ');
}

function parseQuery(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
  let filters = {};
  if (req.query.filters) {
    try { filters = JSON.parse(req.query.filters); } catch (err) { filters = {}; }
  }
  const sortBy = COLUMNS[req.query.sortBy] ? req.query.sortBy : 'date';
  const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';
  return { page, pageSize, filters, sortBy, sortDir };
}

function normalizeRow(r) {
  return {
    ...r,
    revenue: Number(r.revenue) || 0,
    quantity: Number(r.quantity) || 0,
    weight: r.weight == null ? null : Number(r.weight)
  };
}

router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const { page, pageSize, filters, sortBy, sortDir } = parseQuery(req);
  const whereSql = buildWhere(organizationId, filters);
  const orderColSql = sortBy === 'date' ? 's."date"' : COLUMNS[sortBy].sql;
  const orderSql = Prisma.raw(`${orderColSql} ${sortDir}`);
  const skip = (page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw`SELECT ${SELECT_SQL} ${JOIN_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${skip}`,
    prisma.$queryRaw`SELECT COUNT(*) AS "count" ${JOIN_SQL} WHERE ${whereSql}`
  ]);
  res.json({ rows: rows.map(normalizeRow), total: Number(countRows[0].count), page, pageSize });
});

router.get('/export', async (req, res) => {
  const organizationId = req.user.organizationId;
  const { filters, sortBy, sortDir } = parseQuery(req);
  const whereSql = buildWhere(organizationId, filters);
  const orderColSql = sortBy === 'date' ? 's."date"' : COLUMNS[sortBy].sql;
  const orderSql = Prisma.raw(`${orderColSql} ${sortDir}`);

  const rawRows = await prisma.$queryRaw`SELECT ${SELECT_SQL} ${JOIN_SQL} WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${MAX_EXPORT_ROWS}`;
  const rows = rawRows.map(normalizeRow);

  const exportColumns = [
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'customerName', label: 'שם לקוח' },
    { key: 'primaryClass', label: 'סיווג ראשי לקוח' },
    { key: 'customerType', label: 'סוג לקוח' },
    { key: 'city', label: 'עיר' },
    { key: 'centralCustomer', label: 'שם לקוח מרכז' },
    { key: 'customerStatus', label: 'סטטוס לקוח' },
    { key: 'productCode', label: 'קוד פריט' },
    { key: 'productName', label: 'שם פריט' },
    { key: 'type', label: 'טיפוס' },
    { key: 'superType', label: 'טיפוס על' },
    { key: 'department', label: 'מחלקה' },
    { key: 'unit', label: 'יחידת מידה' },
    { key: 'productStatus', label: 'סטטוס מוצר' },
    { key: 'forProcurement', label: 'לעיתוד' },
    { key: 'forMarketing', label: 'לשיווק' },
    { key: 'year', label: 'שנה', value: (r) => new Date(r.date).getFullYear() },
    { key: 'month', label: 'חודש', value: (r) => new Date(r.date).getMonth() + 1 },
    { key: 'revenue', label: 'מכר כספי' },
    { key: 'quantity', label: 'מכר כמותי' },
    { key: 'weight', label: 'משקל' }
  ];
  const buffer = rowsToXlsxBuffer(exportColumns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-full-report.xlsx"');
  res.send(buffer);
});

module.exports = router;
