const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function sumByGroup(groupRows, idField, lookupMap) {
  const out = {};
  groupRows.forEach((r) => {
    const key = lookupMap[r[idField]] || 'לא מסווג';
    out[key] = (out[key] || 0) + (r._sum.revenue || 0);
  });
  return out;
}

function mergeCompare(thisMap, lastMap) {
  const keys = new Set([...Object.keys(thisMap), ...Object.keys(lastMap)]);
  return Array.from(keys).map((k) => {
    const thisYear = thisMap[k] || 0, lastYear = lastMap[k] || 0;
    return { name: k, thisYear, lastYear, deltaPct: lastYear ? Math.round(((thisYear - lastYear) / lastYear) * 100) : null };
  }).sort((a, b) => b.thisYear - a.thisYear);
}

// Cumulative YoY revenue report through the last fully-completed calendar month,
// broken down by sales channel (= customer's primaryClass) and by product superType.
// Aggregation happens in the database (groupBy/aggregate), never by loading the raw
// sales table into memory, since this app is built for hundreds of thousands of rows.
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const now = new Date();
  const year = now.getFullYear();
  const lastCompletedMonth = Math.max(1, now.getMonth()); // months elapsed fully (Jan..this), e.g. Sep(idx8) -> 8 (Jan-Aug)

  const startThis = new Date(year, 0, 1);
  const endThis = new Date(year, lastCompletedMonth, 1);
  const startLast = new Date(year - 1, 0, 1);
  const endLast = new Date(year - 1, lastCompletedMonth, 1);

  const [totalThis, totalLast, byCustThis, byCustLast, byProdThis, byProdLast, rowsThis, rowsLast, customers, products] = await Promise.all([
    prisma.sale.aggregate({ where: { organizationId, date: { gte: startThis, lt: endThis } }, _sum: { revenue: true } }),
    prisma.sale.aggregate({ where: { organizationId, date: { gte: startLast, lt: endLast } }, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where: { organizationId, date: { gte: startThis, lt: endThis } }, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where: { organizationId, date: { gte: startLast, lt: endLast } }, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where: { organizationId, date: { gte: startThis, lt: endThis } }, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where: { organizationId, date: { gte: startLast, lt: endLast } }, _sum: { revenue: true } }),
    prisma.sale.findMany({ where: { organizationId, date: { gte: startThis, lt: endThis } }, select: { date: true, revenue: true } }),
    prisma.sale.findMany({ where: { organizationId, date: { gte: startLast, lt: endLast } }, select: { date: true, revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, primaryClass: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, superType: true } })
  ]);

  const custClass = {}; customers.forEach((c) => { custClass[c.customerNumber] = c.primaryClass || 'לא מסווג'; });
  const prodSuper = {}; products.forEach((p) => { prodSuper[p.itemCode] = p.superType || 'לא מסווג'; });

  const byChannel = mergeCompare(sumByGroup(byCustThis, 'customerNumber', custClass), sumByGroup(byCustLast, 'customerNumber', custClass));
  const bySuperType = mergeCompare(sumByGroup(byProdThis, 'productCode', prodSuper), sumByGroup(byProdLast, 'productCode', prodSuper));

  function monthlySeries(rows) {
    const arr = new Array(lastCompletedMonth).fill(0);
    rows.forEach((r) => { const m = new Date(r.date).getMonth(); if (m < lastCompletedMonth) arr[m] += r.revenue; });
    return arr;
  }

  const thisTotal = totalThis._sum.revenue || 0;
  const lastTotal = totalLast._sum.revenue || 0;

  res.json({
    period: {
      year, priorYear: year - 1, lastCompletedMonth,
      monthNames: MONTH_NAMES.slice(0, lastCompletedMonth),
      label: MONTH_NAMES[0] + '–' + MONTH_NAMES[lastCompletedMonth - 1] + ' ' + year + ' לעומת אותה תקופה ' + (year - 1)
    },
    total: { thisYear: thisTotal, lastYear: lastTotal, deltaPct: lastTotal ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : null },
    byChannel,
    bySuperType,
    monthly: { thisYear: monthlySeries(rowsThis), lastYear: monthlySeries(rowsLast) },
    topChannel: byChannel[0] || null,
    topSuperType: bySuperType[0] || null,
    activeCustomerCount: byCustThis.length,
    activeProductCount: byProdThis.length
  });
});

module.exports = router;
