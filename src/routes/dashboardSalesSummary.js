const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Parses a "YYYY-MM" pair (from <input type="month">) into an exclusive-end date
// range covering every day of every month from `from` through `to` inclusive.
function parseMonthRange(from, to) {
  if (!from || !to) return null;
  const [fy, fm] = String(from).split('-').map(Number);
  const [ty, tm] = String(to).split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return null;
  const start = new Date(fy, fm - 1, 1);
  const end = new Date(ty, tm, 1); // exclusive
  if (!(start < end)) return null;
  return { start, end };
}

function monthsInRange(start, end) {
  const months = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < end && months.length < 120) { // safety valve against malformed ranges
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return months;
}

function rangeLabel(months) {
  if (!months.length) return '';
  const f = months[0], l = months[months.length - 1];
  const fLabel = MONTH_NAMES[f.month - 1] + ' ' + f.year;
  if (months.length === 1) return fLabel;
  return fLabel + '–' + MONTH_NAMES[l.month - 1] + ' ' + l.year;
}

// Dashboard infographic data, sourced from the same sales-full-report consolidation.
// Aggregated in the database and grouped by distinct customer/product (bounded by
// entity count, not raw sale-row count) — never loads the raw sales table into memory,
// except for the trend chart, which only selects {date, revenue}.
//
// Optional filters, all combinable:
// - ?customerNumber= scopes every aggregation to that one customer's sales.
// - ?periodFrom=&periodTo= (each "YYYY-MM") scopes every number on the dashboard to
//   that month range instead of all-time.
// - ?compareFrom=&compareTo= (only meaningful together with a period) adds a second,
//   comparison-period set of totals and a second trend series alongside the period's.
// Every filter is folded into the same organizationId-scoped where clause used
// everywhere else, so values from another organization simply match nothing.
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const customerNumber = req.query.customerNumber ? String(req.query.customerNumber) : null;
  const baseWhere = customerNumber ? { organizationId, customerNumber } : { organizationId };

  const period = parseMonthRange(req.query.periodFrom, req.query.periodTo);
  const compare = period ? parseMonthRange(req.query.compareFrom, req.query.compareTo) : null;
  const where = period ? Object.assign({}, baseWhere, { date: { gte: period.start, lt: period.end } }) : baseWhere;
  const compareWhere = compare ? Object.assign({}, baseWhere, { date: { gte: compare.start, lt: compare.end } }) : null;

  const queries = [
    prisma.sale.aggregate({ where, _sum: { revenue: true, quantity: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where, _sum: { revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, customerType: true, primaryClass: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true, department: true, superType: true } }),
    prisma.sale.findMany({ where, select: { date: true, revenue: true } })
  ];
  if (compareWhere) {
    queries.push(
      prisma.sale.aggregate({ where: compareWhere, _sum: { revenue: true, quantity: true } }),
      prisma.sale.groupBy({ by: ['customerNumber'], where: compareWhere, _sum: { revenue: true } }),
      prisma.sale.groupBy({ by: ['productCode'], where: compareWhere, _sum: { revenue: true } }),
      prisma.sale.findMany({ where: compareWhere, select: { date: true, revenue: true } })
    );
  }
  const results = await Promise.all(queries);
  const [totalAgg, byCust, byProd, customers, products, trendRows] = results;
  const [compareAgg, compareByCust, compareByProd, compareTrendRows] = compareWhere ? results.slice(6) : [null, null, null, null];

  const custMap = {};
  customers.forEach((c) => { custMap[c.customerNumber] = c; });
  const prodMap = {};
  products.forEach((p) => { prodMap[p.itemCode] = p; });

  function groupRevenue(rows, idField, map, classifyField) {
    const out = {};
    rows.forEach((r) => {
      const entity = map[r[idField]];
      const key = (entity && entity[classifyField]) || 'לא מסווג';
      out[key] = (out[key] || 0) + (r._sum.revenue || 0);
    });
    return Object.keys(out).map((name) => ({ name, revenue: out[name] })).sort((a, b) => b.revenue - a.revenue);
  }

  function topN(rows, idField, map, n) {
    return rows.slice()
      .sort((a, b) => (b._sum.revenue || 0) - (a._sum.revenue || 0))
      .slice(0, n)
      .map((r) => ({ code: r[idField], name: (map[r[idField]] && map[r[idField]].name) || r[idField], revenue: r._sum.revenue || 0 }));
  }

  function monthlyRevenue(rows, months) {
    return months.map(({ year, month }) => rows
      .filter((r) => { const d = new Date(r.date); return d.getFullYear() === year && d.getMonth() + 1 === month; })
      .reduce((a, r) => a + r.revenue, 0));
  }

  let yearlyTrend = null, periodTrend = null;
  if (period) {
    // Period mode: one series for the chosen period, and (if given) a second for the
    // comparison period, aligned by relative month position (month 1 of period vs
    // month 1 of comparison, etc.) rather than by calendar month — a period can span
    // any range, not just a full Jan–Dec year, and the two ranges are usually offset
    // by design (e.g. this quarter vs the same quarter last year).
    const periodMonths = monthsInRange(period.start, period.end);
    const compareMonths = compare ? monthsInRange(compare.start, compare.end) : null;
    periodTrend = {
      periodMonths,
      periodLabel: rangeLabel(periodMonths),
      periodData: monthlyRevenue(trendRows, periodMonths),
      compareMonths,
      compareLabel: compareMonths ? rangeLabel(compareMonths) : null,
      compareData: compareMonths ? monthlyRevenue(compareTrendRows, compareMonths) : null
    };
  } else {
    // Default mode: one 12-value (Jan–Dec) series per calendar year that actually has
    // sales data, so the chart compares full years side by side.
    const yearsWithData = new Set();
    trendRows.forEach((r) => yearsWithData.add(new Date(r.date).getFullYear()));
    const years = yearsWithData.size ? Array.from(yearsWithData).sort((a, b) => a - b) : [new Date().getFullYear()];
    yearlyTrend = years.map((year) => {
      const data = new Array(12).fill(0);
      trendRows.forEach((r) => {
        const d = new Date(r.date);
        if (d.getFullYear() === year) data[d.getMonth()] += r.revenue;
      });
      return { year, data };
    });
  }

  res.json({
    customerNumber,
    customerName: customerNumber ? ((custMap[customerNumber] && custMap[customerNumber].name) || customerNumber) : null,
    period: period ? { from: req.query.periodFrom, to: req.query.periodTo, label: rangeLabel(monthsInRange(period.start, period.end)) } : null,
    comparePeriod: compare ? { from: req.query.compareFrom, to: req.query.compareTo, label: rangeLabel(monthsInRange(compare.start, compare.end)) } : null,
    totalRevenue: totalAgg._sum.revenue || 0,
    totalQuantity: totalAgg._sum.quantity || 0,
    activeCustomerCount: byCust.length,
    activeProductCount: byProd.length,
    compareTotals: compareAgg ? {
      totalRevenue: compareAgg._sum.revenue || 0,
      totalQuantity: compareAgg._sum.quantity || 0,
      activeCustomerCount: compareByCust.length,
      activeProductCount: compareByProd.length
    } : null,
    monthNames: MONTH_NAMES,
    yearlyTrend,
    periodTrend,
    byDepartment: groupRevenue(byProd, 'productCode', prodMap, 'department'),
    bySuperType: groupRevenue(byProd, 'productCode', prodMap, 'superType'),
    topCustomers: topN(byCust, 'customerNumber', custMap, 5),
    topProducts: topN(byProd, 'productCode', prodMap, 5)
  });
});

module.exports = router;
