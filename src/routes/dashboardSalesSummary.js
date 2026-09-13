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

// Resolves one side's (primary or comparison) full identity filter — customer,
// product, and/or customer segment — into a Sale where-clause. primaryClass/
// customerType live on Customer, not Sale, so they resolve to a customerNumber
// set first; an explicit customerNumber is only used when no segment is given
// (a segment is the coarser, intentionally-chosen filter when both are present).
async function buildEntityWhere(organizationId, { customerNumber, productCode, primaryClass, customerType }) {
  const where = { organizationId };
  if (primaryClass || customerType) {
    const segCustomers = await prisma.customer.findMany({
      where: Object.assign({ organizationId }, primaryClass && { primaryClass }, customerType && { customerType }),
      select: { customerNumber: true }
    });
    where.customerNumber = { in: segCustomers.map((c) => c.customerNumber) };
  } else if (customerNumber) {
    where.customerNumber = customerNumber;
  }
  if (productCode) where.productCode = productCode;
  return where;
}

// Dashboard infographic data, sourced from the same sales-full-report consolidation.
// Aggregated in the database and grouped by distinct customer/product (bounded by
// entity count, not raw sale-row count) — never loads the raw sales table into memory,
// except for the trend chart, which only selects {date, revenue}.
//
// Optional filters, all combinable:
// - ?customerNumber= / ?productCode= / ?primaryClass= / ?customerType= scope every
//   aggregation to that one customer/product/customer-segment's sales.
// - ?periodMonths= (comma-separated "YYYY-MM" values) scopes every number on the
//   dashboard to that set of months instead of all-time.
// - A comparison series (compareTotals, and — when periodMonths is also set — a
//   second trend series) appears whenever ANY "compare" filter is given:
//   ?compareMonths= (only meaningful together with periodMonths), ?compareCustomerNumber=,
//   ?compareProductCode=, ?comparePrimaryClass=, ?compareCustomerType=. The compare
//   side's customer identity (customerNumber/primaryClass/customerType) is treated as
//   one bundle: if ANY of those three compare-side fields is given, the comparison
//   uses exactly that bundle (no mixing with the primary side's identity); if none is
//   given, it inherits the primary side's identity wholesale. compareProductCode
//   independently falls back to the primary productCode when unset.
// Every filter is folded into the same organizationId-scoped where clause used
// everywhere else, so values from another organization simply match nothing.
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const customerNumber = req.query.customerNumber ? String(req.query.customerNumber) : null;
  const productCode = req.query.productCode ? String(req.query.productCode) : null;
  const primaryClass = req.query.primaryClass ? String(req.query.primaryClass) : null;
  const customerType = req.query.customerType ? String(req.query.customerType) : null;
  const compareCustomerNumber = req.query.compareCustomerNumber ? String(req.query.compareCustomerNumber) : null;
  const compareProductCode = req.query.compareProductCode ? String(req.query.compareProductCode) : null;
  const comparePrimaryClass = req.query.comparePrimaryClass ? String(req.query.comparePrimaryClass) : null;
  const compareCustomerType = req.query.compareCustomerType ? String(req.query.compareCustomerType) : null;

  const hasEntityFilter = !!(customerNumber || productCode || primaryClass || customerType);
  const baseWhere = hasEntityFilter
    ? await buildEntityWhere(organizationId, { customerNumber, productCode, primaryClass, customerType })
    : { organizationId };

  const period = parseMonthList(req.query.periodMonths);
  const compare = period ? parseMonthList(req.query.compareMonths) : null;
  const hasCompareIdentity = !!(compareCustomerNumber || comparePrimaryClass || compareCustomerType);
  const hasEntityCompare = hasCompareIdentity || !!compareProductCode;

  let compareBaseWhere = null;
  if (hasEntityCompare || compare) {
    compareBaseWhere = await buildEntityWhere(organizationId, hasCompareIdentity
      ? { customerNumber: compareCustomerNumber, primaryClass: comparePrimaryClass, customerType: compareCustomerType, productCode: compareProductCode || productCode }
      : { customerNumber, primaryClass, customerType, productCode: compareProductCode || productCode });
  }

  const where = period ? { AND: [baseWhere, monthsWhereClause(period)] } : baseWhere;
  const compareWhere = compareBaseWhere ? (compare ? { AND: [compareBaseWhere, monthsWhereClause(compare)] } : compareBaseWhere) : null;

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

  let monthlyTimeline = null, periodTrend = null;
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
    // Default mode: one continuous month-by-month series spanning the entire sales
    // history that has data (earliest to latest month with a sale), rather than
    // separate per-year series side by side — the whole timeline reads as one
    // continuous trend. `yoyData` is each timeline month's exact same calendar month
    // one year earlier, for the on-chart year-over-year indicator.
    let timelineMonths;
    if (trendRows.length) {
      const monthIndices = trendRows.map((r) => { const d = new Date(r.date); return d.getFullYear() * 12 + d.getMonth(); });
      const minIdx = Math.min.apply(null, monthIndices), maxIdx = Math.max.apply(null, monthIndices);
      timelineMonths = [];
      for (let idx = minIdx; idx <= maxIdx; idx++) timelineMonths.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
    } else {
      const now = new Date();
      timelineMonths = [{ year: now.getFullYear(), month: now.getMonth() + 1 }];
    }
    const timelineYoyMonths = timelineMonths.map(({ year, month }) => ({ year: year - 1, month }));
    monthlyTimeline = {
      months: timelineMonths.map((m) => m.year + '-' + String(m.month).padStart(2, '0')),
      data: monthlyRevenue(trendRows, timelineMonths),
      yoyData: monthlyRevenue(trendRows, timelineYoyMonths)
    };
  }

  res.json({
    customerNumber,
    customerName: customerNumber ? ((custMap[customerNumber] && custMap[customerNumber].name) || customerNumber) : null,
    productCode,
    productName: productCode ? ((prodMap[productCode] && prodMap[productCode].name) || productCode) : null,
    primaryClass,
    customerType,
    period: period ? { months: period.map((m) => m.year + '-' + String(m.month).padStart(2, '0')), label: monthsLabel(period) } : null,
    comparePeriod: compare ? { months: compare.map((m) => m.year + '-' + String(m.month).padStart(2, '0')), label: monthsLabel(compare) } : null,
    compareCustomerNumber,
    compareCustomerName: compareCustomerNumber ? ((custMap[compareCustomerNumber] && custMap[compareCustomerNumber].name) || compareCustomerNumber) : null,
    compareProductCode,
    compareProductName: compareProductCode ? ((prodMap[compareProductCode] && prodMap[compareProductCode].name) || compareProductCode) : null,
    comparePrimaryClass,
    compareCustomerType,
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
    monthlyTimeline,
    periodTrend,
    byDepartment: groupRevenue(byProd, 'productCode', prodMap, 'department'),
    bySuperType: groupRevenue(byProd, 'productCode', prodMap, 'superType'),
    topCustomers: topN(byCust, 'customerNumber', custMap, 5),
    topProducts: topN(byProd, 'productCode', prodMap, customerNumber ? 10 : 5)
  });
});

module.exports = router;
