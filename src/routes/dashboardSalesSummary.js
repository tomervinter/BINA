const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Dashboard infographic data, sourced from the same sales-full-report consolidation.
// Aggregated in the database and grouped by distinct customer/product (bounded by
// entity count, not raw sale-row count) — never loads the raw sales table into memory,
// except for the monthly trend, which only ever selects {date, revenue} for a bounded
// 12-month window.
//
// An optional ?customerNumber= scopes every aggregation to that one customer's sales,
// so the whole dashboard can show "all customers" or "just this one" — the filter is
// folded into the same organizationId-scoped where clause used everywhere else, so a
// customerNumber from another organization simply matches nothing.
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const customerNumber = req.query.customerNumber ? String(req.query.customerNumber) : null;
  const where = customerNumber ? { organizationId, customerNumber } : { organizationId };
  const now = new Date();
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [totalAgg, byCust, byProd, customers, products, monthlyRows] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { revenue: true, quantity: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where, _sum: { revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, customerType: true, primaryClass: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true, department: true, superType: true } }),
    prisma.sale.findMany({ where: Object.assign({}, where, { date: { gte: trendStart } }), select: { date: true, revenue: true } })
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

  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthly.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear(), revenue: 0 });
  }
  const monthlyIndex = {};
  monthly.forEach((m, idx) => { monthlyIndex[m.year + '-' + m.month] = idx; });
  monthlyRows.forEach((r) => {
    const d = new Date(r.date);
    const key = d.getFullYear() + '-' + (d.getMonth() + 1);
    if (key in monthlyIndex) monthly[monthlyIndex[key]].revenue += r.revenue;
  });

  res.json({
    customerNumber,
    customerName: customerNumber ? ((custMap[customerNumber] && custMap[customerNumber].name) || customerNumber) : null,
    totalRevenue: totalAgg._sum.revenue || 0,
    totalQuantity: totalAgg._sum.quantity || 0,
    activeCustomerCount: byCust.length,
    activeProductCount: byProd.length,
    monthly,
    byDepartment: groupRevenue(byProd, 'productCode', prodMap, 'department'),
    bySuperType: groupRevenue(byProd, 'productCode', prodMap, 'superType'),
    topCustomers: topN(byCust, 'customerNumber', custMap, 5),
    topProducts: topN(byProd, 'productCode', prodMap, 5)
  });
});

module.exports = router;
