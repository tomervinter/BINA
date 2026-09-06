const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

// Dashboard infographic data, sourced from the same sales-full-report consolidation.
// Aggregated in the database and grouped by distinct customer/product (bounded by
// entity count, not raw sale-row count) — never loads the raw sales table into memory.
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const [totalAgg, byCust, byProd, customers, products] = await Promise.all([
    prisma.sale.aggregate({ where: { organizationId }, _sum: { revenue: true, quantity: true } }),
    prisma.sale.groupBy({ by: ['customerNumber'], where: { organizationId }, _sum: { revenue: true } }),
    prisma.sale.groupBy({ by: ['productCode'], where: { organizationId }, _sum: { revenue: true } }),
    prisma.customer.findMany({ where: { organizationId }, select: { customerNumber: true, name: true, customerType: true } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true, department: true } })
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
      .map((r) => ({ name: (map[r[idField]] && map[r[idField]].name) || r[idField], revenue: r._sum.revenue || 0 }));
  }

  res.json({
    totalRevenue: totalAgg._sum.revenue || 0,
    totalQuantity: totalAgg._sum.quantity || 0,
    activeCustomerCount: byCust.length,
    activeProductCount: byProd.length,
    byCustomerType: groupRevenue(byCust, 'customerNumber', custMap, 'customerType'),
    byDepartment: groupRevenue(byProd, 'productCode', prodMap, 'department'),
    topCustomers: topN(byCust, 'customerNumber', custMap, 5),
    topProducts: topN(byProd, 'productCode', prodMap, 5)
  });
});

module.exports = router;
