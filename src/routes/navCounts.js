const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

// Cheap counts for the sidebar's live badges — count() only, no row data.
// Deliberately excludes an insights count: that requires running the full insights
// engine over every sale, which would mean recomputing it on every page navigation
// (this endpoint loads on every page via the shared sidebar) — too expensive at the
// hundreds-of-thousands-of-rows scale this app is built for.
router.get('/', async (req, res) => {
  const orgId = req.user.organizationId;
  const [sales, customers, activeCustomers, products, inventory, holidays, seasons] = await Promise.all([
    prisma.sale.count({ where: { organizationId: orgId } }),
    prisma.customer.count({ where: { organizationId: orgId } }),
    prisma.customer.count({ where: { organizationId: orgId, NOT: { status: { startsWith: 'לא' } } } }),
    prisma.product.count({ where: { organizationId: orgId } }),
    prisma.inventoryRecord.count({ where: { organizationId: orgId } }),
    prisma.holiday.count({ where: { organizationId: orgId } }),
    prisma.season.count({ where: { organizationId: orgId } })
  ]);
  res.json({ sales, customers, activeCustomers, products, inventory, holidays, seasons });
});

module.exports = router;
