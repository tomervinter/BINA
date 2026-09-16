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
async function buildEntityWhere(organizationId, { customerNumbers, productCodes, primaryClasses, customerTypes, cities, centralCustomers, superTypes, departments, restrictToCustomers }) {
  const where = { organizationId };
  let resolvedCustomers = null;
  if (primaryClasses.length || customerTypes.length || (cities && cities.length) || (centralCustomers && centralCustomers.length)) {
    const segCustomers = await prisma.customer.findMany({
      where: Object.assign({ organizationId }, primaryClasses.length && { primaryClass: { in: primaryClasses } }, customerTypes.length && { customerType: { in: customerTypes } },
        cities && cities.length && { city: { in: cities } }, centralCustomers && centralCustomers.length && { centralCustomer: { in: centralCustomers } }),
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
  // superType/department live on Product, not Sale — same segment-over-explicit
  // precedence as primaryClass/customerType above: either one wins over an explicit
  // productCode list when given (and if both superType and department are given,
  // both apply together — same AND combination as primaryClass+customerType).
  let resolvedProducts = null;
  if ((superTypes && superTypes.length) || (departments && departments.length)) {
    const segProducts = await prisma.product.findMany({
      where: Object.assign({ organizationId }, superTypes && superTypes.length && { superType: { in: superTypes } }, departments && departments.length && { department: { in: departments } }),
      select: { itemCode: true }
    });
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

// Total quantity each customer bought across the given products (scoped to `period`
// the same way resolvePurchaseCohort's distinctBuyers is) — used to show "how much of
// product X did this customer actually buy" alongside the "bought X" cohort list.
async function boughtQuantityByCustomer(organizationId, productCodes, period) {
  if (!productCodes.length) return {};
  const dateWhere = period ? monthsWhereClause(period) : {};
  const rows = await prisma.sale.groupBy({
    by: ['customerNumber'],
    where: Object.assign({ organizationId, productCode: { in: productCodes } }, dateWhere),
    _sum: { quantity: true }
  });
  const map = {};
  rows.forEach((r) => { map[r.customerNumber] = r._sum.quantity || 0; });
  return map;
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
  const cities = parseCsv(req.query.city);
  const centralCustomers = parseCsv(req.query.centralCustomer);
  const superTypes = parseCsv(req.query.superType);
  const departments = parseCsv(req.query.department);
  const compareCustomerNumbers = parseCsv(req.query.compareCustomerNumber);
  const compareProductCodes = parseCsv(req.query.compareProductCode);
  const comparePrimaryClasses = parseCsv(req.query.comparePrimaryClass);
  const compareCustomerTypes = parseCsv(req.query.compareCustomerType);
  const compareCities = parseCsv(req.query.compareCity);
  const compareCentralCustomers = parseCsv(req.query.compareCentralCustomer);
  const compareSuperTypes = parseCsv(req.query.compareSuperType);
  const compareDepartments = parseCsv(req.query.compareDepartment);
  const boughtProducts = parseCsv(req.query.boughtProducts);
  const notBoughtProducts = parseCsv(req.query.notBoughtProducts);
  const period = parseMonthList(req.query.periodMonths);

  // "Bought X" / "didn't buy Y" is scoped to the selected period, same as every other
  // number on the dashboard — not "ever bought", unless no period filter is active.
  const purchaseCohort = await resolvePurchaseCohort(organizationId, boughtProducts, notBoughtProducts, period);
  const boughtQtyMap = await boughtQuantityByCustomer(organizationId, boughtProducts, period);
  const hasEntityFilter = !!(customerNumbers.length || productCodes.length || primaryClasses.length || customerTypes.length || cities.length || centralCustomers.length || superTypes.length || departments.length || purchaseCohort);
  const baseWhere = hasEntityFilter
    ? await buildEntityWhere(organizationId, { customerNumbers, productCodes, primaryClasses, customerTypes, cities, centralCustomers, superTypes, departments, restrictToCustomers: purchaseCohort })
    : { organizationId };

  const compare = period ? parseMonthList(req.query.compareMonths) : null;
  const hasCompareIdentity = !!(compareCustomerNumbers.length || comparePrimaryClasses.length || compareCustomerTypes.length || compareCities.length || compareCentralCustomers.length);
  const hasEntityCompare = hasCompareIdentity || !!compareProductCodes.length || !!compareSuperTypes.length || !!compareDepartments.length;
  const effectiveCompareProducts = compareProductCodes.length ? compareProductCodes : productCodes;
  // superType/department fall back independently too, exactly like productCode above
  // — they're the same product dimension, just the coarser (segment) form of it.
  const effectiveCompareSuperTypes = compareSuperTypes.length ? compareSuperTypes : superTypes;
  const effectiveCompareDepartments = compareDepartments.length ? compareDepartments : departments;

  let compareBaseWhere = null;
  if (hasEntityCompare || compare) {
    compareBaseWhere = await buildEntityWhere(organizationId, hasCompareIdentity
      ? { customerNumbers: compareCustomerNumbers, primaryClasses: comparePrimaryClasses, customerTypes: compareCustomerTypes, cities: compareCities, centralCustomers: compareCentralCustomers, productCodes: effectiveCompareProducts, superTypes: effectiveCompareSuperTypes, departments: effectiveCompareDepartments }
      : { customerNumbers, primaryClasses, customerTypes, cities, centralCustomers, productCodes: effectiveCompareProducts, superTypes: effectiveCompareSuperTypes, departments: effectiveCompareDepartments });
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
    prisma.sale.findMany({ where: baseWhere, select: { date: true, revenue: true } })
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
    customerType: (custMap[cn] && custMap[cn].customerType) || null,
    boughtQuantity: boughtProducts.length ? (boughtQtyMap[cn] || 0) : null
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
    //
    // The current, still-in-progress calendar month is always included as the last
    // bar even when it has no sale rows yet (or fewer than a full month's worth) —
    // otherwise the chart would just silently stop at last month and look like the
    // most recent data is missing, when really the month simply isn't over. The
    // frontend marks this specific bar as "not yet complete" (see inProgressMonth
    // below); the YoY indicator already separately skips it on its own (see
    // buildYoyEntries in dashboard-sales-summary.js), since a partial month isn't a
    // meaningful like-for-like comparison against a full month last year.
    const now = new Date();
    const curIdx = now.getFullYear() * 12 + now.getMonth();
    const allRows = compareTrendRows ? trendRows.concat(compareTrendRows) : trendRows;
    let timelineMonths;
    if (allRows.length) {
      const monthIndices = allRows.map((r) => { const d = new Date(r.date); return d.getFullYear() * 12 + d.getMonth(); });
      const minIdx = Math.min.apply(null, monthIndices);
      const maxIdx = Math.max(Math.max.apply(null, monthIndices), curIdx);
      timelineMonths = [];
      for (let idx = minIdx; idx <= maxIdx; idx++) timelineMonths.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
    } else {
      timelineMonths = [{ year: now.getFullYear(), month: now.getMonth() + 1 }];
    }
    const timelineYoyMonths = timelineMonths.map(({ year, month }) => ({ year: year - 1, month }));
    monthlyTimeline = {
      months: timelineMonths.map((m) => m.year + '-' + String(m.month).padStart(2, '0')),
      data: monthlyRevenue(trendRows, timelineMonths),
      compareData: compareTrendRows ? monthlyRevenue(compareTrendRows, timelineMonths) : null,
      yoyData: monthlyRevenue(trendRows, timelineYoyMonths),
      inProgressMonth: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
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
    cities,
    centralCustomers,
    superTypes,
    departments,
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
    compareCities,
    compareCentralCustomers,
    compareSuperTypes: effectiveCompareSuperTypes,
    compareDepartments: effectiveCompareDepartments,
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
  const boughtQtyMap = await boughtQuantityByCustomer(organizationId, boughtProducts, period);
  const hasEntityFilter = !!(customerNumbers.length || primaryClasses.length || customerTypes.length || purchaseCohort);
  const where = hasEntityFilter
    ? await buildEntityWhere(organizationId, { customerNumbers, productCodes: [], primaryClasses, customerTypes, restrictToCustomers: purchaseCohort })
    : { organizationId };
  const customerFilter = where.customerNumber ? { organizationId, customerNumber: where.customerNumber } : { organizationId };
  const rows = (await prisma.customer.findMany({ where: customerFilter, orderBy: { name: 'asc' } }))
    .map((r) => Object.assign({}, r, { boughtQuantity: boughtProducts.length ? (boughtQtyMap[r.customerNumber] || 0) : '' }));
  const buffer = rowsToXlsxBuffer([
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'name', label: 'שם לקוח' },
    { key: 'centralCustomer', label: 'לקוח מרכז' },
    { key: 'primaryClass', label: 'סיווג ראשי לקוח' },
    { key: 'customerType', label: 'סוג לקוח' },
    { key: 'boughtQuantity', label: 'כמות שנרכשה' }
  ], rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customers-filtered.xlsx"');
  res.send(buffer);
});

// Resolves the "lapsed regular buyers" panel: customers who bought in at least
// `minMonths` DISTINCT calendar months over the last 12 FULLY completed months
// (the in-progress current month is never counted toward this — a customer isn't
// "regular" because they happened to already buy once this month), but have NOT
// bought anything yet in the current month. Two separate queries rather than one
// grouped one: which months a customer bought in (to count distinct months) is a
// different question from whether they bought in the specific current-month
// window (to exclude them) — trying to answer both from one row set would need
// the same date column sliced two different ways at once. `entityFilters`, when
// given, is the exact same shape buildEntityWhere takes for the main dashboard
// endpoint — passed through so this panel respects whatever customer/product/
// segment filters are active in the main filter table, exactly like every other
// chart on the page.
async function resolveLapsedCustomers(organizationId, minMonths, entityFilters) {
  const now = new Date();
  const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const hasEntityFilter = !!(entityFilters.customerNumbers.length || entityFilters.productCodes.length || entityFilters.primaryClasses.length ||
    entityFilters.customerTypes.length || entityFilters.cities.length || entityFilters.centralCustomers.length || entityFilters.superTypes.length || entityFilters.departments.length);
  const baseWhere = hasEntityFilter ? await buildEntityWhere(organizationId, entityFilters) : { organizationId };
  const [pastSales, curMonthBuyers, customers] = await Promise.all([
    prisma.sale.findMany({ where: Object.assign({}, baseWhere, { date: { gte: windowStart, lt: curMonthStart } }), select: { customerNumber: true, date: true, revenue: true } }),
    prisma.sale.findMany({ where: Object.assign({}, baseWhere, { date: { gte: curMonthStart, lt: nextMonthStart } }), select: { customerNumber: true }, distinct: ['customerNumber'] }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, centralCustomer: true, primaryClass: true, customerType: true } })
  ]);
  const monthSetByCustomer = {};
  // Per-customer, per-month revenue within the same 12-month window — only used by
  // the Excel export's horizontal month layout (see /lapsed-customers/export), not
  // by the on-screen table, so it's built here (reusing pastSales) rather than with
  // a separate query.
  const monthlyRevenueByCustomer = {};
  pastSales.forEach((s) => {
    const mk = s.date.getFullYear() + '-' + String(s.date.getMonth() + 1).padStart(2, '0');
    (monthSetByCustomer[s.customerNumber] = monthSetByCustomer[s.customerNumber] || new Set()).add(mk);
    const rev = (monthlyRevenueByCustomer[s.customerNumber] = monthlyRevenueByCustomer[s.customerNumber] || {});
    rev[mk] = (rev[mk] || 0) + (s.revenue || 0);
  });
  const boughtThisMonth = new Set(curMonthBuyers.map((s) => s.customerNumber));
  const custMap = {};
  customers.forEach((c) => { custMap[c.customerNumber] = c; });
  const matches = Object.keys(monthSetByCustomer)
    .filter((cn) => monthSetByCustomer[cn].size >= minMonths && !boughtThisMonth.has(cn))
    .map((cn) => ({
      customerNumber: cn,
      name: (custMap[cn] && custMap[cn].name) || cn,
      centralCustomer: (custMap[cn] && custMap[cn].centralCustomer) || null,
      primaryClass: (custMap[cn] && custMap[cn].primaryClass) || null,
      customerType: (custMap[cn] && custMap[cn].customerType) || null,
      activeMonths: monthSetByCustomer[cn].size,
      monthlyRevenue: monthlyRevenueByCustomer[cn] || {}
    }))
    .sort((a, b) => b.activeMonths - a.activeMonths);
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  const monthsWindow = [];
  for (let idx = nowIdx - 12; idx <= nowIdx - 1; idx++) monthsWindow.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
  return { currentMonthLabel: MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear(), matches, monthsWindow };
}

function parseLapsedEntityFilters(req) {
  return {
    customerNumbers: parseCsv(req.query.customerNumber),
    productCodes: parseCsv(req.query.productCode),
    primaryClasses: parseCsv(req.query.primaryClass),
    customerTypes: parseCsv(req.query.customerType),
    cities: parseCsv(req.query.city),
    centralCustomers: parseCsv(req.query.centralCustomer),
    superTypes: parseCsv(req.query.superType),
    departments: parseCsv(req.query.department)
  };
}

router.get('/lapsed-customers', async (req, res) => {
  const organizationId = req.user.organizationId;
  const minMonths = Math.min(12, Math.max(1, parseInt(req.query.minMonths, 10) || 7));
  const { currentMonthLabel, matches } = await resolveLapsedCustomers(organizationId, minMonths, parseLapsedEntityFilters(req));
  // monthlyRevenue is only for the Excel export's month grid (see /export below) —
  // the on-screen table stays exactly as before, just the activeMonths count.
  const customers = matches.map(({ monthlyRevenue, ...rest }) => rest);
  res.json({ minMonths, currentMonthLabel, customers });
});

router.get('/lapsed-customers/export', async (req, res) => {
  const organizationId = req.user.organizationId;
  const minMonths = Math.min(12, Math.max(1, parseInt(req.query.minMonths, 10) || 7));
  const { matches, monthsWindow } = await resolveLapsedCustomers(organizationId, minMonths, parseLapsedEntityFilters(req));
  // Excel-only horizontal month breakdown: one amount column per trailing month
  // (the same 12-month window the "חודשי רכישה" count is based on), labeled with
  // just the short month name — a 0 already reads as "didn't buy" on its own, so
  // there's no separate קנה/לא קנה column. The on-screen table stays as a single
  // activeMonths count, unchanged.
  const monthColumns = [];
  monthsWindow.forEach(({ year, month }) => {
    const mk = year + '-' + String(month).padStart(2, '0');
    const shortLabel = MONTH_NAMES[month - 1] + ' ' + String(year).slice(-2);
    monthColumns.push({ key: 'amount_' + mk, label: shortLabel, value: (row) => Math.round((row.monthlyRevenue[mk] || 0) * 100) / 100 });
  });
  const buffer = rowsToXlsxBuffer([
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'name', label: 'שם לקוח' },
    { key: 'centralCustomer', label: 'לקוח מרכז' },
    { key: 'primaryClass', label: 'סיווג ראשי לקוח' },
    { key: 'customerType', label: 'סוג לקוח' },
    { key: 'activeMonths', label: 'חודשי רכישה' }
  ].concat(monthColumns), matches);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="lapsed-customers.xlsx"');
  res.send(buffer);
});

// Resolves the "declining customers" panel: for every customer, sums revenue
// Jan-through-the-last-FULLY-completed-month of this year against the exact
// same period last year (the in-progress current month is excluded from both
// sides, same convention as everywhere else in this file — comparing a partial
// current month against a full month last year would be misleading). A
// customer qualifies when this year's cumulative total is below last year's by
// at least `minDeclinePct`; `entityFilters` scopes both years' sales identically
// to the active customer/product/segment filters, same as the lapsed-customers
// panel beside it. Returns one row PER (customer, declined product) pair — not
// one row per customer with a joined product list — so a customer with several
// declining products gets one line per product (including a product bought
// last year but not at all this year, i.e. a 100% drop), not just family-level,
// since this is a quick overview list rather than a rigorous insight.
async function resolveDecliningCustomers(organizationId, minDeclinePct, entityFilters) {
  const now = new Date();
  const year = now.getFullYear();
  const lastCompletedMonth = Math.max(1, now.getMonth()); // count of fully-completed months, e.g. 8 in September
  const curStart = new Date(year, 0, 1), curEnd = new Date(year, lastCompletedMonth, 1);
  const priorStart = new Date(year - 1, 0, 1), priorEnd = new Date(year - 1, lastCompletedMonth, 1);
  const hasEntityFilter = !!(entityFilters.customerNumbers.length || entityFilters.productCodes.length || entityFilters.primaryClasses.length ||
    entityFilters.customerTypes.length || entityFilters.cities.length || entityFilters.centralCustomers.length || entityFilters.superTypes.length || entityFilters.departments.length);
  const baseWhere = hasEntityFilter ? await buildEntityWhere(organizationId, entityFilters) : { organizationId };
  const [curSales, priorSales, customers, products] = await Promise.all([
    prisma.sale.findMany({ where: Object.assign({}, baseWhere, { date: { gte: curStart, lt: curEnd } }), select: { customerNumber: true, productCode: true, revenue: true } }),
    prisma.sale.findMany({ where: Object.assign({}, baseWhere, { date: { gte: priorStart, lt: priorEnd } }), select: { customerNumber: true, productCode: true, revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, centralCustomer: true, primaryClass: true, customerType: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true } })
  ]);
  const custMap = {}; customers.forEach((c) => { custMap[c.customerNumber] = c; });
  const prodMap = {}; products.forEach((p) => { prodMap[p.itemCode] = p; });

  function sumByCustomer(rows) {
    const out = {};
    rows.forEach((r) => { out[r.customerNumber] = (out[r.customerNumber] || 0) + (r.revenue || 0); });
    return out;
  }
  function sumByCustomerProduct(rows) {
    const out = {};
    rows.forEach((r) => {
      const key = r.customerNumber + '|' + r.productCode;
      out[key] = (out[key] || 0) + (r.revenue || 0);
    });
    return out;
  }
  const curTotals = sumByCustomer(curSales), priorTotals = sumByCustomer(priorSales);
  const curByProduct = sumByCustomerProduct(curSales), priorByProduct = sumByCustomerProduct(priorSales);

  const matches = [];
  Object.keys(priorTotals).forEach((cid) => {
    const priorTotal = priorTotals[cid];
    if (priorTotal <= 0) return;
    const curTotal = curTotals[cid] || 0;
    if (curTotal >= priorTotal) return; // only a real decline counts
    const declinePct = ((priorTotal - curTotal) / priorTotal) * 100;
    if (declinePct < minDeclinePct) return;
    const priorProductKeys = Object.keys(priorByProduct).filter((k) => k.startsWith(cid + '|'));
    const declinedProducts = priorProductKeys
      .map((k) => {
        const pid = k.slice(cid.length + 1);
        const priorRev = priorByProduct[k];
        const curRev = curByProduct[k] || 0;
        return curRev < priorRev ? { pid, name: (prodMap[pid] && prodMap[pid].name) || pid, drop: priorRev - curRev } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.drop - a.drop);
    if (!declinedProducts.length) return; // shouldn't happen (a total decline implies at least one product dropped), but guards against an empty row
    const base = {
      customerNumber: cid,
      name: (custMap[cid] && custMap[cid].name) || cid,
      centralCustomer: (custMap[cid] && custMap[cid].centralCustomer) || null,
      primaryClass: (custMap[cid] && custMap[cid].primaryClass) || null,
      customerType: (custMap[cid] && custMap[cid].customerType) || null,
      declinePct: Math.round(declinePct * 10) / 10
    };
    declinedProducts.forEach((p) => matches.push(Object.assign({}, base, { productCode: p.pid, productName: p.name })));
  });
  matches.sort((a, b) => b.declinePct - a.declinePct);
  const customerCount = new Set(matches.map((m) => m.customerNumber)).size;
  return {
    yearLabel: String(year), priorYearLabel: String(year - 1),
    lastCompletedMonthLabel: MONTH_NAMES[lastCompletedMonth - 1] + ' ' + year,
    customerCount, matches
  };
}

// A plain `|| 10` fallback would also override an explicit, legitimate 0 (user
// wants "any decline, no minimum") since parseFloat('0') is falsy in JS — only
// fall back to the default when the param is actually missing/unparseable.
function parseMinDeclinePct(raw) {
  const parsed = parseFloat(raw);
  return Math.max(0, isNaN(parsed) ? 10 : parsed);
}

router.get('/declining-customers', async (req, res) => {
  const organizationId = req.user.organizationId;
  const minDeclinePct = parseMinDeclinePct(req.query.minDeclinePct);
  const { yearLabel, priorYearLabel, lastCompletedMonthLabel, customerCount, matches } = await resolveDecliningCustomers(organizationId, minDeclinePct, parseLapsedEntityFilters(req));
  res.json({ minDeclinePct, yearLabel, priorYearLabel, lastCompletedMonthLabel, customerCount, customers: matches });
});

router.get('/declining-customers/export', async (req, res) => {
  const organizationId = req.user.organizationId;
  const minDeclinePct = parseMinDeclinePct(req.query.minDeclinePct);
  const { matches } = await resolveDecliningCustomers(organizationId, minDeclinePct, parseLapsedEntityFilters(req));
  const buffer = rowsToXlsxBuffer([
    { key: 'customerNumber', label: 'מספר לקוח' },
    { key: 'name', label: 'שם לקוח' },
    { key: 'centralCustomer', label: 'לקוח מרכז' },
    { key: 'primaryClass', label: 'סיווג ראשי לקוח' },
    { key: 'customerType', label: 'סוג לקוח' },
    { key: 'declinePct', label: 'ירידה מצטברת (%)' },
    { key: 'productCode', label: 'מק"ט' },
    { key: 'productName', label: 'שם מוצר' }
  ], matches);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="declining-customers.xlsx"');
  res.send(buffer);
});

module.exports = router;
