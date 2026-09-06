const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseListQuery } = require('../lib/listQuery');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');

const router = express.Router();
router.use(requireAuth);

const SORTABLE = ['customerNumber', 'productCode', 'date', 'quantity', 'revenue', 'weight'];
const FILTERABLE = ['customerNumber', 'productCode'];
const MAX_EXPORT_ROWS = 100000;

const EXPORT_COLUMNS = [
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

// One consolidated read-only view: every sale row plus every field from the customer
// and product master tables, so nothing about a sale requires cross-referencing three
// separate screens. Joined in JS against small per-page code sets rather than a real
// SQL join, matching the rest of the app's sales-at-scale pattern (bulkInsert, listQuery).
async function attachMasterData(rows, organizationId) {
  const customerNumbers = Array.from(new Set(rows.map((r) => r.customerNumber)));
  const productCodes = Array.from(new Set(rows.map((r) => r.productCode)));
  const [customers, products] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId, customerNumber: { in: customerNumbers } } }),
    prisma.product.findMany({ where: { organizationId, itemCode: { in: productCodes } } })
  ]);
  const custByNumber = {};
  customers.forEach((c) => { custByNumber[c.customerNumber] = c; });
  const prodByCode = {};
  products.forEach((p) => { prodByCode[p.itemCode] = p; });
  return rows.map((r) => {
    const c = custByNumber[r.customerNumber] || {};
    const p = prodByCode[r.productCode] || {};
    return {
      ...r,
      customerName: c.name || '',
      primaryClass: c.primaryClass || '',
      customerType: c.customerType || '',
      city: c.city || '',
      centralCustomer: c.centralCustomer || '',
      customerStatus: c.status || '',
      productName: p.name || '',
      type: p.type || '',
      superType: p.superType || '',
      department: p.department || '',
      unit: p.unit || '',
      productStatus: p.status || '',
      forProcurement: p.forProcurement || '',
      forMarketing: p.forMarketing || ''
    };
  });
}

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
  const rows = await attachMasterData(rawRows, req.user.organizationId);
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
  const rows = await attachMasterData(rawRows, req.user.organizationId);
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-full-report.xlsx"');
  res.send(buffer);
});

module.exports = router;
