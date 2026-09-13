const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');

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

// Parses a comma-separated list of raw string values (customer numbers, product
// codes, or segment names — none of which can themselves contain a comma in this
// app's data) into a deduplicated array; "" for an absent param.
function parseCsv(str) {
  if (!str) return [];
  return Array.from(new Set(String(str).split(',').map((s) => s.trim()).filter(Boolean)));
}

// Resolves one side's (primary or comparison) full identity filter — any number of
// customers, products, and/or customer segments, all OR'd within each dimension and
// AND'd across dimensions — into a Sale where-clause. primaryClass/customerType live
// on Customer, not Sale, so they resolve to a customerNumber set first; explicit
// customerNumbers are only used when no segment is given (a segment is the coarser,
// intentionally-chosen filter when both are present). `restrictToCustomers`, when
// given, further narrows whatever customer set was otherwise resolved (or, if none
// was, becomes the customer set outright) — used for the purchase-based cohort
// filter (customers who bought/didn't buy certain products), which only ever applies
// to the primary side.
async function buildEntityWhere(organizationId, { customerNumbers, productCodes, primaryClasses, customerTypes, superTypes, restrictToCustomers }) {
  const where = { organizationId };
  let resolvedCustomers = null;
  if (primaryClasses.length || customerTypes.length) {
    const segCustomers = await prisma.customer.findMany({
      where: Object.assign({ organizationId }, primaryClasses.length && { primaryClass: { in: primaryClasses } }, customerTypes.length && { customerType: { in: customerTypes } }),
      select: { customerNumber: true }
    });
    resolvedCustomers = segCustomers.map((c) => c.customerNumber);
  } else if (customerNumbers.length) {
    resolvedCustomers = customerNumbers;
  }
  if (restrictToCustomers) {
    const restrictSet = new Set(restrictToCustomers);
    resolvedCustomers = resolvedCustomers ? resolvedCustomers.filter((c) => restrictSet.has(c)) : restrictToCustomers;
  }
  if (resolvedCustomers) where.customerNumber = { in: resolvedCustomers };
  // superType lives on Product, not Sale — same segment-over-explicit precedence as
  // primaryClass/customerType above: a superType selection is the coarser,
  // intentionally-chosen filter, so it wins over an explicit productCode list when
  // both are given.
  let resolvedProducts = null;
  if (superTypes && superTypes.length) {
    const segProducts = await prisma.product.findMany({ where: { organizationId, superType: { in: superTypes } }, select: { itemCode: true } });
    resolvedProducts = segProducts.map((p) => p.itemCode);
  } else if (productCodes.length) {
    resolvedProducts = productCodes;
  }
  if (resolvedProducts) where.productCode = { in: resolvedProducts };
  return where;
}

// Resolves the "customers who bought X but not Y" cohort filter to a customer-number
// array, or null when neither list is given (no cohort constraint at all). Buying is
// "at least one sale of at least one product in the list, within the selected period
// if one is set" (OR within each list); the two lists combine as bought MINUS
// excluded. With no boughtProducts, the starting set is every customer in the org (so
// notBoughtProducts alone means "everyone except those who bought these"). `period`
// (an array of {year, month}, from parseMonthList) scopes both lists to the same
// months as the rest of the dashboard — "bought X" means "bought X during the
// selected period", not "ever bought X".
async function resolvePurchaseCohort(organizationId, boughtProducts, notBoughtProducts, period) {
  if (!boughtProducts.length && !notBoughtProducts.length) return null;
  const dateWhere = period ? monthsWhereClause(period) : {};
  const distinctBuyers = async (codes) => {
    const rows = await prisma.sale.findMany({ where: Object.assign({ organizationId, productCode: { in: codes } }, dateWhere), select: { customerNumber: true }, distinct: ['customerNumber'] });
    return new Set(rows.map((r) => r.customerNumber));
  };
  const [boughtSet, excludeSet] = await Promise.all([
    boughtProducts.length ? distinctBuyers(boughtProducts) : null,
    notBoughtProducts.length ? distinctBuyers(notBoughtProducts) : Promise.resolve(new Set())
  ]);
  let base;
  if (boughtSet) {
    base = Array.from(boughtSet);
  } else {
    const allCustomers = await prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true } });
    base = allCustomers.map((c) => c.customerNumber);
  }
  return base.filter((c) => !excludeSet.has(c));
}

// Dashboard infographic data, sourced from the same sales-full-report consolidation.
// Aggregated in the database and grouped by distinct customer/product (bounded by
// entity count, not raw sale-row count) — never loads the raw sales table into memory,
// except for the trend chart, which only selects {date, revenue}.
//
// Optional filters, all combinable:
// - ?customerNumber= / ?productCode= / ?primaryClass= / ?customerType= (each a
//   comma-separated list — one value works the same as before) scope every
//   aggregation to that set of customers/products/customer-segments' sales, OR'd
//   within each dimension and AND'd across dimensions.
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
  const customerNumbers = parseCsv(req.query.customerNumber);
  const productCodes = parseCsv(req.query.productCode);
  const primaryClasses = parseCsv(req.query.primaryClass);
  const customerTypes = parseCsv(req.query.customerType);
  const superTypes = parseCsv(req.query.superType);
  const compareCustomerNumbers = parseCsv(req.query.compareCustomerNumber);
  const compareProductCodes = parseCsv(req.query.compareProductCode);
  const comparePrimaryClasses = parseCsv(req.query.comparePrimaryClass);
  const compareCustomerTypes = parseCsv(req.query.compareCustomerType);
  const compareSuperTypes = parseCsv(req.query.compareSuperType);
  const boughtProducts = parseCsv(req.query.boughtProducts);
  const notBoughtProducts = parseCsv(req.query.notBoughtProducts);
  const period = parseMonthList(req.query.periodMonths);

  // "Bought X" / "didn't buy Y" is scoped to the selected period, same as every other
  // number on the dashboard — not "ever bought", unless no period filter is active.
  const purchaseCohort = await resolvePurchaseCohort(organizationId, boughtProducts, notBoughtProducts, period);
  const hasEntityFilter = !!(customerNumbers.length || productCodes.length || primaryClasses.length || customerTypes.length || superTypes.length || purchaseCohort);
  const baseWhere = hasEntityFilter
    ? await buildEntityWhere(organizationId, { customerNumbers, productCodes, primaryClasses, customerTypes, superTypes, restrictToCustomers: purchaseCohort })
    : { organizationId };

  const compare = period ? parseMonthList(req.query.compareMonths) : null;
  const hasCompareIdentity = !!(compareCustomerNumbers.length || comparePrimaryClasses.length || compareCustomerTypes.length);
  const hasEntityCompare = hasCompareIdentity || !!compareProductCodes.length || !!compareSuperTypes.length;
  const effectiveCompareProducts = compareProductCodes.length ? compareProductCodes : productCodes;
  // superType falls back independently too, exactly like productCode above — it's
  // the same product dimension, just the coarser (segment) form of it.
  const effectiveCompareSuperTypes = compareSuperTypes.length ? compareSuperTypes : superTypes;

  let compareBaseWhere = null;
  if (hasEntityCompare || compare) {
    compareBaseWhere = await buildEntityWhere(organizationId, hasCompareIdentity
      ? { customerNumbers: compareCustomerNumbers, primaryClasses: comparePrimaryClasses, customerTypes: compareCustomerTypes, productCodes: effectiveCompareProducts, superTypes: effectiveCompareSuperTypes }
      : { customerNumbers, primaryClasses, customerTypes, productCodes: effectiveCompareProducts, superTypes: effectiveCompareSuperTypes });
  }

  const where = period ? { AND: [baseWhere, monthsWhereClause(period)] } : baseWhere;
  const compareWhere = compareBaseWhere ? (compare ? { AND: [compareBaseWhere, monthsWhereClause(compare)] } : compareBaseWhere) : null;

  const queries = [
    prisma.sale.aggregate({ where, _sum: { revenue: true, quantity: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where, _sum: { revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, customerType: true, primaryClass: true, centralCustomer: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true, department: true, superType: true } }),
    // Unrestricted by the period/compare date filters (customer filter still applies)
    // so the trend chart can always look up a given month's year-earlier counterpart
    // for the year-over-year indicator, regardless of which months were selected.
    prisma.sale.findMany({ where: baseWhere, select: { date: true, revenue: true, weight: true } })
  ];
  if (compareWhere) {
    queries.push(
      prisma.sale.aggregate({ where: compareWhere, _sum: { revenue: true, quantity: true } }),
      prisma.sale.groupBy({ by: ['customerNumber'], where: compareWhere, _sum: { revenue: true } }),
      prisma.sale.groupBy({ by: ['productCode'], where: compareWhere, _sum: { revenue: true } }),
      // Unrestricted by compareMonths (same reasoning as trendRows above) so the
      // default continuous-timeline chart can plot the comparison entity's own
      // month-by-month series alongside the primary one, not just its totals.
      prisma.sale.findMany({ where: compareBaseWhere, select: { date: true, revenue: true } })
    );
  }
  const results = await Promise.all(queries);
  const [totalAgg, byCust, byProd, customers, products, trendRows] = results;
  const [compareAgg, compareByCust, compareByProd, compareTrendRows] = compareWhere ? results.slice(6) : [null, null, null, null];

  const custMap = {};
  customers.forEach((c) => { custMap[c.customerNumber] = c; });
  const prodMap = {};
  products.forEach((p) => { prodMap[p.itemCode] = p; });

  // The exact customer set the primary side's filters resolved to (customer/segment
  // selection and/or the purchase cohort) — null when nothing narrowed the customer
  // set at all (a product-only filter, say, restricts sale rows but not to a specific
  // customer list). Surfaced so the dashboard can show/export the matching customers.
  const filteredCustomerNumbers = baseWhere.customerNumber ? baseWhere.customerNumber.in : null;
  const filteredCustomers = filteredCustomerNumbers ? filteredCustomerNumbers.map((cn) => ({
    customerNumber: cn,
    name: (custMap[cn] && custMap[cn].name) || cn,
    centralCustomer: (custMap[cn] && custMap[cn].centralCustomer) || null,
    primaryClass: (custMap[cn] && custMap[cn].primaryClass) || null,
    customerType: (custMap[cn] && custMap[cn].customerType) || null
  })) : null;

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

  // Sale.weight is optional — sales rows recorded before the column existed (or from
  // a source that never tracked it) come back null, which is treated as 0 rather than
  // skewing the total. Only computed for the primary continuous timeline (below), the
  // one chart that shows it.
  function monthlyWeight(rows, months) {
    return months.map(({ year, month }) => rows
      .filter((r) => { const d = new Date(r.date); return d.getFullYear() === year && d.getMonth() + 1 === month; })
      .reduce((a, r) => a + (r.weight || 0), 0));
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
    // continuous trend. When an entity comparison is active (customer/product/segment
    // vs another), the timeline spans BOTH entities' data so the comparison series can
    // be plotted alongside the primary one, month for month. `yoyData` is each
    // timeline month's exact same calendar month one year earlier, for the on-chart
    // year-over-year indicator (drawn on the primary series only).
    const allRows = compareTrendRows ? trendRows.concat(compareTrendRows) : trendRows;
    let timelineMonths;
    if (allRows.length) {
      const monthIndices = allRows.map((r) => { const d = new Date(r.date); return d.getFullYear() * 12 + d.getMonth(); });
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
      compareData: compareTrendRows ? monthlyRevenue(compareTrendRows, timelineMonths) : null,
      yoyData: monthlyRevenue(trendRows, timelineYoyMonths),
      weight: monthlyWeight(trendRows, timelineMonths)
    };
  }

  const nameOf = (map, code) => (map[code] && map[code].name) || code;
  res.json({
    customerNumbers,
    customerNames: customerNumbers.map((c) => nameOf(custMap, c)),
    productCodes,
    productNames: productCodes.map((p) => nameOf(prodMap, p)),
    primaryClasses,
    customerTypes,
    superTypes,
    boughtProducts,
    boughtProductNames: boughtProducts.map((p) => nameOf(prodMap, p)),
    notBoughtProducts,
    notBoughtProductNames: notBoughtProducts.map((p) => nameOf(prodMap, p)),
    filteredCustomers,
    period: period ? { months: period.map((m) => m.year + '-' + String(m.month).padStart(2, '0')), label: monthsLabel(period) } : null,
    comparePeriod: compare ? { months: compare.map((m) => m.year + '-' + String(m.month).padStart(2, '0')), label: monthsLabel(compare) } : null,
    compareCustomerNumbers,
    compareCustomerNames: compareCustomerNumbers.map((c) => nameOf(custMap, c)),
    compareProductCodes,
    compareProductNames: compareProductCodes.map((p) => nameOf(prodMap, p)),
    comparePrimaryClasses,
    compareCustomerTypes,
    compareSuperTypes: effectiveCompareSuperTypes,
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
    topProducts: topN(byProd, 'productCode', prodMap, customerNumbers.length ? 10 : 5),
    // Same four breakdowns for the comparison side, when a comparison is active —
    // each of the dashboard's breakdown charts can then show a primary/comparison
    // pair side by side, the same way the trend chart already does.
    compareByDepartment: compareByProd ? groupRevenue(compareByProd, 'productCode', prodMap, 'department') : null,
    compareBySuperType: compareByProd ? groupRevenue(compareByProd, 'productCode', prodMap, 'superType') : null,
    compareTopCustomers: compareByCust ? topN(compareByCust, 'customerNumber', custMap, 5) : null,
    compareTopProducts: compareByProd ? topN(compareByProd, 'productCode', prodMap, customerNumbers.length ? 10 : 5) : null
  });
});

// Real .xlsx export of the exact customer list the primary side's filters (customer/
// segment selection and/or the "bought X but not Y" purchase cohort) resolve to —
// same query params as the main endpoint, re-resolved independently since this is a
// separate request/response cycle.
router.get('/cohort-customers/export', async (req, res) => {
  const organizationId = req.user.organizationId;
  const customerNumbers = parseCsv(req.query.customerNumber);
  const primaryClasses = parseCsv(req.query.primaryClass);
  const customerTypes = parseCsv(req.query.customerType);
  const boughtProducts = parseCsv(req.query.boughtProducts);
  const notBoughtProducts = parseCsv(req.query.notBoughtProducts);
  const period = parseMonthList(req.query.periodMonths);
  const purchaseCohort = await resolvePurchaseCohort(organizationId, boughtProducts, notBoughtProducts, period);
  const hasEntityFilter = !!(customerNumbers.length || primaryClasses.length || customerTypes.length || purchaseCohort);
  const where = hasEntityFilter
    ? await buildEntityWhere(organizationId, { customerNumbers, productCodes: [], primaryClasses, customerTypes, restrictToCustomers: purchaseCohort })
    : { organizationId };
  const customerFilter = where.customerNumber ? { organizationId, customerNumber: where.customerNumber } : { organizationId };
  const rows = await prisma.customer.findMany({ where: customerFilter, orderBy: { name: 'asc' } });
  const buffer = rowsToXlsxBuffer([
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'name', label: 'שם לקוח' },
    { key: 'centralCustomer', label: 'לקוח מרכז' },
    { key: 'primaryClass', label: 'סיווג ראשי לקוח' },
    { key: 'customerType', label: 'סוג לקוח' }
  ], rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customers-filtered.xlsx"');
  res.send(buffer);
});

module.exports = router;
