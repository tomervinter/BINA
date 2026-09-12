const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Parses a comma-separated "YYYY-MM,YYYY-MM,..." list (from the dashboard's month
// multi-select — see month-multiselect.js) into a sorted array of {year, month},
// deduplicated. The set need not be contiguous — a "period" can be any hand-picked
// set of months, not just a range.
function parseMonthList(str) {
  if (!str) return null;
  const seen = new Set();
  const months = String(str).split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => {
      const [y, m] = s.split('-').map(Number);
      return (y && m >= 1 && m <= 12) ? { year: y, month: m } : null;
    })
    .filter((m) => m && !seen.has(m.year + '-' + m.month) && seen.add(m.year + '-' + m.month));
  if (!months.length) return null;
  months.sort((a, b) => a.year - b.year || a.month - b.month);
  return months;
}

// Builds a Prisma OR-of-date-ranges condition matching exactly the given months.
function monthsWhereClause(months) {
  return {
    OR: months.map(({ year, month }) => ({
      date: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) }
    }))
  };
}

function monthsLabel(months) {
  if (!months.length) return '';
  if (months.length <= 3) return months.map((m) => MONTH_NAMES[m.month - 1] + ' ' + m.year).join(', ');
  const f = months[0], l = months[months.length - 1];
  return months.length + ' חודשים (' + MONTH_NAMES[f.month - 1] + ' ' + f.year + '–' + MONTH_NAMES[l.month - 1] + ' ' + l.year + ')';
}

// Dashboard infographic data, sourced from the same sales-full-report consolidation.
// Aggregated in the database and grouped by distinct customer/product (bounded by
// entity count, not raw sale-row count) — never loads the raw sales table into memory,
// except for the trend chart, which only selects {date, revenue}.
//
// Optional filters, all combinable:
// - ?customerNumber= scopes every aggregation to that one customer's sales.
// - ?periodMonths= (comma-separated "YYYY-MM" values) scopes every number on the
//   dashboard to that set of months instead of all-time.
// - ?compareMonths= (only meaningful together with periodMonths) adds a second,
//   comparison set of totals and a second trend series alongside the period's.
// Every filter is folded into the same organizationId-scoped where clause used
// everywhere else, so values from another organization simply match nothing.
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const customerNumber = req.query.customerNumber ? String(req.query.customerNumber) : null;
  const baseWhere = customerNumber ? { organizationId, customerNumber } : { organizationId };

  const period = parseMonthList(req.query.periodMonths);
  const compare = period ? parseMonthList(req.query.compareMonths) : null;
  const where = period ? { AND: [baseWhere, monthsWhereClause(period)] } : baseWhere;
  const compareWhere = compare ? { AND: [baseWhere, monthsWhereClause(compare)] } : null;

  const queries = [
    prisma.sale.aggregate({ where, _sum: { revenue: true, quantity: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where, _sum: { revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, customerType: true, primaryClass: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true, department: true, superType: true } }),
    // Unrestricted by the period/compare date filters (customer filter still applies)
    // so the trend chart can always look up a given month's year-earlier counterpart
    // for the year-over-year indicator, regardless of which months were selected.
    prisma.sale.findMany({ where: baseWhere, select: { date: true, revenue: true } })
  ];
  if (compareWhere) {
    queries.push(
      prisma.sale.aggregate({ where: compareWhere, _sum: { revenue: true, quantity: true } }),
      prisma.sale.groupBy({ by: ['customerNumber'], where: compareWhere, _sum: { revenue: true } }),
      prisma.sale.groupBy({ by: ['productCode'], where: compareWhere, _sum: { revenue: true } })
    );
  }
  const results = await Promise.all(queries);
  const [totalAgg, byCust, byProd, customers, products, trendRows] = results;
  const [compareAgg, compareByCust, compareByProd] = compareWhere ? results.slice(6) : [null, null, null];

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
    // Period mode: one series for the chosen months, and (if given) a second for the
    // comparison months, aligned by relative position (1st selected period month vs
    // 1st selected comparison month, etc.) rather than by calendar month — the set
    // need not be contiguous, and the two sets are usually offset by design (e.g.
    // this quarter's months vs the same quarter last year). Independent of whatever
    // comparison the user picked, `yoyData` always looks up each selected month's
    // exact same calendar month one year earlier, for the on-chart YoY indicator.
    const yoyMonths = period.map(({ year, month }) => ({ year: year - 1, month }));
    periodTrend = {
      periodMonths: period,
      periodLabel: monthsLabel(period),
      periodData: monthlyRevenue(trendRows, period),
      compareMonths: compare,
      compareLabel: compare ? monthsLabel(compare) : null,
      compareData: compare ? monthlyRevenue(trendRows, compare) : null,
      yoyData: monthlyRevenue(trendRows, yoyMonths)
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
    period: period ? { months: period.map((m) => m.year + '-' + String(m.month).padStart(2, '0')), label: monthsLabel(period) } : null,
    comparePeriod: compare ? { months: compare.map((m) => m.year + '-' + String(m.month).padStart(2, '0')), label: monthsLabel(compare) } : null,
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
