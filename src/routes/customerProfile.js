const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const DAY_MS = 86400000;
function isInactive(cust) { return !!(cust && String(cust.status || '').trim().indexOf('לא') === 0); }
function isProductInactive(prod) { return !!(prod && String(prod.status || '').trim().indexOf('לא') === 0); }
function monthKey(t) { const d = new Date(t); const mm = d.getMonth() + 1; return d.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm); }
function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function isOutOfStock(invIndex, pid) {
  const row = invIndex[pid];
  const stock = row ? row.stock : null;
  return stock !== null && stock <= 0;
}

// Cross-sell gap within a cohort of "similar" customers (same primaryClass or same
// customerType): products most of the cohort buys that this customer doesn't. Scoped
// to the cohort's own customer numbers only — never loads the org's full sales table.
async function cohortGaps(organizationId, cohortField, cohortValue, custId, ownProductSet, prodIndex, invIndex) {
  if (!cohortValue) return { members: [], gaps: [] };
  const peers = await prisma.customer.findMany({ where: { organizationId, [cohortField]: cohortValue }, select: { customerNumber: true, status: true } });
  const activePeers = peers.filter((c) => !isInactive(c));
  const peerNumbers = activePeers.map((c) => c.customerNumber);
  if (peerNumbers.length < 2) return { members: activePeers, gaps: [] };

  const pairs = await prisma.sale.groupBy({ by: ['customerNumber', 'productCode'], where: { organizationId, customerNumber: { in: peerNumbers } } });
  const buyerCount = {};
  pairs.forEach((r) => { buyerCount[r.productCode] = (buyerCount[r.productCode] || 0) + 1; });

  const gaps = Object.keys(buyerCount)
    .filter((pid) => buyerCount[pid] >= Math.ceil(peerNumbers.length * 0.5) && !ownProductSet[pid] && !isProductInactive(prodIndex[pid]) && !isOutOfStock(invIndex, pid))
    .map((pid) => ({ productCode: pid, name: (prodIndex[pid] && prodIndex[pid].name) || pid, buyerCount: buyerCount[pid], cohortSize: peerNumbers.length }))
    .sort((a, b) => b.buyerCount - a.buyerCount);
  return { members: activePeers, gaps };
}

// Everything for the customer card in one call: identity, KPIs, full monthly revenue
// trend, product breakdown, open insights, and cross-sell gaps against same-segment
// and same-type peers. Every query is scoped to this one customer (or a bounded
// cohort of peers) — never the organization's whole sales table.
router.get('/:customerNumber', async (req, res) => {
  const organizationId = req.user.organizationId;
  const cid = req.params.customerNumber;

  const [cust, custSales, products, inventory, insights] = await Promise.all([
    prisma.customer.findFirst({ where: { organizationId, customerNumber: cid } }),
    prisma.sale.findMany({ where: { organizationId, customerNumber: cid } }),
    prisma.product.findMany({ where: { organizationId } }),
    prisma.inventoryRecord.findMany({ where: { organizationId } }),
    prisma.insight.findMany({ where: { organizationId, customerId: cid } })
  ]);
  if (!cust) return res.status(404).json({ error: 'לקוח לא נמצא' });

  const prodIndex = {};
  products.forEach((p) => { prodIndex[p.itemCode] = p; });
  const invIndex = {};
  inventory.forEach((r) => { if (r.sku && !(r.sku in invIndex)) invIndex[r.sku] = r; });

  const events = custSales.map((r) => ({ pid: r.productCode, t: new Date(r.date).getTime(), qty: r.quantity, rev: r.revenue })).sort((a, b) => a.t - b.t);
  const now = Date.now();
  const totalRevenue = events.reduce((a, e) => a + e.rev, 0);
  const totalQty = events.reduce((a, e) => a + e.qty, 0);
  const lastPurchase = events.length ? events[events.length - 1].t : null;

  const monthSet = {};
  events.forEach((e) => { monthSet[monthKey(e.t)] = true; });
  const monthTimes = Object.keys(monthSet).map((mk) => { const [y, m] = mk.split('-'); return new Date(+y, +m - 1, 1).getTime(); }).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < monthTimes.length; i++) gaps.push((monthTimes[i] - monthTimes[i - 1]) / DAY_MS);
  const typicalGapDays = gaps.length ? median(gaps) : null;
  const curMonthActive = monthSet[monthKey(now)] || false;

  const monthlyMap = {};
  events.forEach((e) => { monthlyMap[monthKey(e.t)] = (monthlyMap[monthKey(e.t)] || { revenue: 0, qty: 0 }); monthlyMap[monthKey(e.t)].revenue += e.rev; monthlyMap[monthKey(e.t)].qty += e.qty; });
  const monthly = Object.keys(monthlyMap).sort().map((mk) => ({ month: mk, revenue: monthlyMap[mk].revenue, qty: monthlyMap[mk].qty }));

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
      productCode: pid, name: (prod && prod.name) || pid, active: !isProductInactive(prod),
      qty: p.qty, rev: p.rev, lastPurchase: lastT, daysSince: Math.round((now - lastT) / DAY_MS)
    };
  }).sort((a, b) => b.rev - a.rev);
  const ownProductSet = {};
  productRows.forEach((p) => { ownProductSet[p.productCode] = true; });

  // Segment averages: how this customer's revenue compares to the average of active
  // peers sharing the same primaryClass / customerType — scoped to just those peers.
  async function segmentAvg(field, value) {
    if (!value) return { avg: 0, size: 0 };
    const peers = await prisma.customer.findMany({ where: { organizationId, [field]: value }, select: { customerNumber: true, status: true } });
    const activeIds = peers.filter((c) => !isInactive(c)).map((c) => c.customerNumber);
    if (!activeIds.length) return { avg: 0, size: 0 };
    const agg = await prisma.sale.groupBy({ by: ['customerNumber'], where: { organizationId, customerNumber: { in: activeIds } }, _sum: { revenue: true } });
    const revs = activeIds.map((id) => { const row = agg.find((r) => r.customerNumber === id); return row ? (row._sum.revenue || 0) : 0; });
    return { avg: revs.reduce((a, b) => a + b, 0) / revs.length, size: activeIds.length };
  }

  const [primaryClassAvg, customerTypeAvg, primaryClassGaps, customerTypeGaps] = await Promise.all([
    segmentAvg('primaryClass', cust.primaryClass),
    segmentAvg('customerType', cust.customerType),
    cohortGaps(organizationId, 'primaryClass', cust.primaryClass, cid, ownProductSet, prodIndex, invIndex),
    cohortGaps(organizationId, 'customerType', cust.customerType, cid, ownProductSet, prodIndex, invIndex)
  ]);

  res.json({
    customer: cust,
    totalRevenue, totalQty, lastPurchase, typicalGapDays, curMonthActive,
    monthly, products: productRows,
    openInsightCount: insights.length,
    insights: insights.map((i) => ({
      type: i.type, severity: i.severity, message: i.message, productCode: i.productCode,
      breakdown: (() => { try { return i.breakdown ? JSON.parse(i.breakdown) : null; } catch (err) { return null; } })()
    })),
    primaryClass: { name: cust.primaryClass || '', avgRevenue: primaryClassAvg.avg, cohortSize: primaryClassAvg.size, gaps: primaryClassGaps.gaps },
    customerType: { name: cust.customerType || '', avgRevenue: customerTypeAvg.avg, cohortSize: customerTypeAvg.size, gaps: customerTypeGaps.gaps }
  });
});

// Product-level comparison between two arbitrary month ranges (each "YYYY-MM"),
// e.g. this-year-so-far vs the same window last year, or any two custom periods.
router.get('/:customerNumber/period-compare', async (req, res) => {
  const organizationId = req.user.organizationId;
  const cid = req.params.customerNumber;

  function parseMonthParam(s, endExclusive) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2];
    return endExclusive ? new Date(y, mo, 1) : new Date(y, mo - 1, 1);
  }
  const fromA = parseMonthParam(req.query.fromA);
  const toA = parseMonthParam(req.query.toA, true);
  const fromB = parseMonthParam(req.query.fromB);
  const toB = parseMonthParam(req.query.toB, true);
  if (!fromA || !toA || !fromB || !toB) return res.status(400).json({ error: 'טווח תאריכים לא תקין' });

  const [products, rowsA, rowsB] = await Promise.all([
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true } }),
    prisma.sale.findMany({ where: { organizationId, customerNumber: cid, date: { gte: fromA, lt: toA } }, select: { productCode: true, quantity: true, revenue: true } }),
    prisma.sale.findMany({ where: { organizationId, customerNumber: cid, date: { gte: fromB, lt: toB } }, select: { productCode: true, quantity: true, revenue: true } })
  ]);
  const prodName = {};
  products.forEach((p) => { prodName[p.itemCode] = p.name; });

  function sumByProduct(rows) {
    const out = {};
    rows.forEach((r) => { out[r.productCode] = out[r.productCode] || { revenue: 0, qty: 0 }; out[r.productCode].revenue += r.revenue; out[r.productCode].qty += r.quantity; });
    return out;
  }
  const sumA = sumByProduct(rowsA);
  const sumB = sumByProduct(rowsB);
  const allPids = new Set([...Object.keys(sumA), ...Object.keys(sumB)]);
  const rows = Array.from(allPids).map((pid) => {
    const a = sumA[pid] || { revenue: 0, qty: 0 };
    const b = sumB[pid] || { revenue: 0, qty: 0 };
    const deltaPct = a.revenue ? Math.round(((b.revenue - a.revenue) / a.revenue) * 100) : (b.revenue ? null : 0);
    return { productCode: pid, name: prodName[pid] || pid, revenueA: a.revenue, qtyA: a.qty, revenueB: b.revenue, qtyB: b.qty, deltaPct };
  }).sort((x, y) => (y.revenueA + y.revenueB) - (x.revenueA + x.revenueB));

  res.json({
    totalA: rowsA.reduce((s, r) => s + r.revenue, 0),
    totalB: rowsB.reduce((s, r) => s + r.revenue, 0),
    rows
  });
});

module.exports = router;
