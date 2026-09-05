const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer } = require('../lib/csv');
const { parseListQuery } = require('../lib/listQuery');

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

  await prisma.$transaction([
    prisma.customer.deleteMany({ where: { organizationId: orgId } }),
    prisma.customer.createMany({ data: rows })
  ]);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.customer.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

const DAY_MS = 86400000;
function isInactive(cust) { return !!(cust && String(cust.status || '').trim().indexOf('לא') === 0); }
function isProductInactive(prod) { return !!(prod && String(prod.status || '').trim().indexOf('לא') === 0); }
function monthKey(t) { const d = new Date(t); const mm = d.getMonth() + 1; return d.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm); }
function dayKey(t) { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Full drill-down profile for the customer investigation card: KPIs, monthly revenue,
// per-product breakdown, and comparisons against the customer's own segment/type peers.
// Computed server-side (not shipped raw to the browser) since it aggregates the org's
// entire sales history.
router.get('/:customerNumber/profile', async (req, res) => {
  const orgId = req.user.organizationId;
  const cid = req.params.customerNumber;
  const [cust, products, sales, allCustomers] = await Promise.all([
    prisma.customer.findFirst({ where: { organizationId: orgId, customerNumber: cid } }),
    prisma.product.findMany({ where: { organizationId: orgId } }),
    prisma.sale.findMany({ where: { organizationId: orgId } }),
    prisma.customer.findMany({ where: { organizationId: orgId } })
  ]);
  if (!cust) return res.status(404).json({ error: 'לקוח לא נמצא' });

  const prodIndex = {};
  products.forEach((p) => { prodIndex[p.itemCode] = p; });
  const now = Date.now();

  const events = sales.filter((r) => r.customerNumber === cid)
    .map((r) => ({ pid: r.productCode, t: new Date(r.date).getTime(), qty: r.quantity, rev: r.revenue }))
    .sort((a, b) => a.t - b.t);

  const totalRevenue = events.reduce((a, e) => a + e.rev, 0);
  const totalQty = events.reduce((a, e) => a + e.qty, 0);
  const lastPurchase = events.length ? events[events.length - 1].t : null;

  const dropSet = {};
  events.forEach((e) => { dropSet[dayKey(e.t)] = e.t; });
  const dropTimes = Object.keys(dropSet).map((k) => dropSet[k]).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < dropTimes.length; i++) gaps.push((dropTimes[i] - dropTimes[i - 1]) / DAY_MS);
  const typicalGapDays = gaps.length ? median(gaps) : null;
  const curDrops30 = dropTimes.filter((t) => t > now - 30 * DAY_MS && t <= now).length;
  const prevDrops30 = dropTimes.filter((t) => t > now - 60 * DAY_MS && t <= now - 30 * DAY_MS).length;

  const monthlyMap = {};
  events.forEach((e) => { monthlyMap[monthKey(e.t)] = (monthlyMap[monthKey(e.t)] || 0) + e.rev; });
  const monthKeys = Object.keys(monthlyMap).sort();
  const monthly = monthKeys.slice(-6).map((mk) => ({ month: mk, revenue: monthlyMap[mk] }));

  const byProduct = {};
  events.forEach((e) => {
    if (!byProduct[e.pid]) byProduct[e.pid] = { pid: e.pid, qty: 0, rev: 0, times: [] };
    byProduct[e.pid].qty += e.qty;
    byProduct[e.pid].rev += e.rev;
    byProduct[e.pid].times.push(e.t);
  });
  const productRows = Object.keys(byProduct).map((pid) => {
    const p = byProduct[pid];
    p.times.sort((a, b) => a - b);
    const lastT = p.times[p.times.length - 1];
    const prod = prodIndex[pid];
    return {
      pid, name: (prod && prod.name) || pid, active: !isProductInactive(prod),
      qty: p.qty, rev: p.rev, lastPurchase: lastT, daysSince: Math.round((now - lastT) / DAY_MS)
    };
  }).sort((a, b) => b.rev - a.rev);

  const seg = cust.primaryClass || '';
  const activeCustomers = allCustomers.filter((c) => !isInactive(c));
  const segMembers = seg ? activeCustomers.filter((c) => (c.primaryClass || '') === seg) : [];
  const revByCustomer = {};
  sales.forEach((r) => { revByCustomer[r.customerNumber] = (revByCustomer[r.customerNumber] || 0) + r.revenue; });
  const segRevenues = segMembers.map((c) => revByCustomer[c.customerNumber] || 0);
  const segAvg = segRevenues.length ? segRevenues.reduce((a, b) => a + b, 0) / segRevenues.length : 0;

  const custProductsSet = {};
  productRows.forEach((p) => { custProductsSet[p.pid] = true; });
  const typeName = cust.customerType || '';
  const typeMembers = typeName ? activeCustomers.filter((c) => (c.customerType || '') === typeName) : [];
  const typeProductCounts = {};
  typeMembers.forEach((c) => {
    const seen = {};
    sales.forEach((r) => {
      if (r.customerNumber !== c.customerNumber) return;
      if (r.productCode && !seen[r.productCode]) { seen[r.productCode] = true; typeProductCounts[r.productCode] = (typeProductCounts[r.productCode] || 0) + 1; }
    });
  });
  const varietyGaps = Object.keys(typeProductCounts).filter((pid) =>
    typeMembers.length >= 2 && typeProductCounts[pid] >= Math.ceil(typeMembers.length * 0.5) && !custProductsSet[pid] && !isProductInactive(prodIndex[pid])
  ).map((pid) => ({ pid, name: (prodIndex[pid] && prodIndex[pid].name) || pid, count: typeProductCounts[pid] }))
    .sort((a, b) => b.count - a.count);

  res.json({
    customer: cust,
    totalRevenue, totalQty, lastPurchase, typicalGapDays,
    curDrops30, prevDrops30, totalDrops: dropTimes.length,
    monthly, products: productRows,
    segmentName: seg, segmentAvg: segAvg, segmentSize: segMembers.length,
    typeName, typeSize: typeMembers.length, varietyGaps
  });
});

module.exports = router;
