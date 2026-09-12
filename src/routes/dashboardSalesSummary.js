const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Dashboard infographic data, sourced from the same sales-full-report consolidation.
// Aggregated in the database and grouped by distinct customer/product (bounded by
// entity count, not raw sale-row count) — never loads the raw sales table into memory,
// except for the year-over-year trend, which only selects {date, revenue} but for
// every sale (not windowed to a trailing period), since the chart compares full
// calendar years side by side rather than a rolling 12 months.
//
// An optional ?customerNumber= scopes every aggregation to that one customer's sales,
// so the whole dashboard can show "all customers" or "just this one" — the filter is
// folded into the same organizationId-scoped where clause used everywhere else, so a
// customerNumber from another organization simply matches nothing.
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const customerNumber = req.query.customerNumber ? String(req.query.customerNumber) : null;
  const where = customerNumber ? { organizationId, customerNumber } : { organizationId };

  const [totalAgg, byCust, byProd, customers, products, yearlyRows] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { revenue: true, quantity: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where, _sum: { revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, customerType: true, primaryClass: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true, department: true, superType: true } }),
    prisma.sale.findMany({ where, select: { date: true, revenue: true } })
  ]);

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

  // Year-over-year monthly revenue: one 12-value (Jan–Dec) series per calendar year
  // that actually has sales data, so the chart compares full years side by side
  // instead of a rolling trailing window.
  const yearsWithData = new Set();
  yearlyRows.forEach((r) => yearsWithData.add(new Date(r.date).getFullYear()));
  const years = yearsWithData.size ? Array.from(yearsWithData).sort((a, b) => a - b) : [new Date().getFullYear()];
  const yearlyTrend = years.map((year) => {
    const data = new Array(12).fill(0);
    yearlyRows.forEach((r) => {
      const d = new Date(r.date);
      if (d.getFullYear() === year) data[d.getMonth()] += r.revenue;
    });
    return { year, data };
  });

  res.json({
    customerNumber,
    customerName: customerNumber ? ((custMap[customerNumber] && custMap[customerNumber].name) || customerNumber) : null,
    totalRevenue: totalAgg._sum.revenue || 0,
    totalQuantity: totalAgg._sum.quantity || 0,
    activeCustomerCount: byCust.length,
    activeProductCount: byProd.length,
    monthNames: MONTH_NAMES,
    yearlyTrend,
    byDepartment: groupRevenue(byProd, 'productCode', prodMap, 'department'),
    bySuperType: groupRevenue(byProd, 'productCode', prodMap, 'superType'),
    topCustomers: topN(byCust, 'customerNumber', custMap, 5),
    topProducts: topN(byProd, 'productCode', prodMap, 5)
  });
});

module.exports = router;
