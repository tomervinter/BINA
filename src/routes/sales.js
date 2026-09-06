const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer, parseNumber } = require('../lib/csv');
const { parseListQuery } = require('../lib/listQuery');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');
const { replaceAll } = require('../lib/bulkInsert');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

const SORTABLE = ['customerNumber', 'productCode', 'date', 'quantity', 'revenue', 'weight'];
const FILTERABLE = ['customerNumber', 'productCode'];
const MAX_EXPORT_ROWS = 100000;
const EXPORT_COLUMNS = [
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

// Sale rows only store the customer/product code (the master tables are the single
// source of truth for names, wholesale-replaced on every master upload) — join in
// the display name for the current page/export rather than denormalizing it onto Sale.
async function attachNames(rows, organizationId) {
  const customerNumbers = Array.from(new Set(rows.map((r) => r.customerNumber)));
  const productCodes = Array.from(new Set(rows.map((r) => r.productCode)));
  const [customers, products] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId, customerNumber: { in: customerNumbers } }, select: { customerNumber: true, name: true } }),
    prisma.product.findMany({ where: { organizationId, itemCode: { in: productCodes } }, select: { itemCode: true, name: true } })
  ]);
  const custNameByNumber = {};
  customers.forEach((c) => { custNameByNumber[c.customerNumber] = c.name; });
  const prodNameByCode = {};
  products.forEach((p) => { prodNameByCode[p.itemCode] = p.name; });
  return rows.map((r) => ({
    ...r,
    customerName: custNameByNumber[r.customerNumber] || '',
    productName: prodNameByCode[r.productCode] || ''
  }));
}

// Sales can run into the hundreds of thousands of rows, so filtering is limited to the
// text columns (customerNumber/productCode) — DB-level substring search on numbers/dates
// isn't practical at that scale, but sorting is still supported on every column.
router.get('/', async (req, res) => {
  const { page, pageSize, sortBy, sortDir, where, skip, take } = parseListQuery(req, {
    sortableFields: SORTABLE,
    filterableFields: FILTERABLE,
    defaultSort: { field: 'date', dir: 'desc' }
  });
  const fullWhere = { organizationId: req.user.organizationId, ...where };
  const [rawRows, total] = await Promise.all([
    prisma.sale.findMany({ where: fullWhere, orderBy: { [sortBy]: sortDir }, skip, take }),
    prisma.sale.count({ where: fullWhere })
  ]);
  const rows = await attachNames(rawRows, req.user.organizationId);
  res.json({ rows, total, page, pageSize });
});

router.get('/export', async (req, res) => {
  const { sortBy, sortDir, where } = parseListQuery(req, {
    sortableFields: SORTABLE,
    filterableFields: FILTERABLE,
    defaultSort: { field: 'date', dir: 'desc' }
  });
  const rawRows = await prisma.sale.findMany({
    where: { organizationId: req.user.organizationId, ...where },
    orderBy: { [sortBy]: sortDir },
    take: MAX_EXPORT_ROWS
  });
  const rows = await attachNames(rawRows, req.user.organizationId);
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sales.xlsx"');
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

  await replaceAll(prisma, 'sale', { organizationId: orgId }, rows);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.sale.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
