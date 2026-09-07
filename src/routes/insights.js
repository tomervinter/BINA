const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { computeInsights } = require('../lib/insightsEngine');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');

const router = express.Router();
router.use(requireAuth);

const sevRank = { high: 0, medium: 1, low: 2 };
function sortInsights(rows) {
  return rows.slice().sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || Math.abs(b.metric) - Math.abs(a.metric));
}

// Insights are a generated snapshot, not a live computation — see the Insight model's
// comment. GET just reads whatever the last "יצירת תובנות" run produced.
router.get('/', async (req, res) => {
  const rows = await prisma.insight.findMany({ where: { organizationId: req.user.organizationId } });
  res.json(sortInsights(rows));
});

router.post('/generate', async (req, res) => {
  const organizationId = req.user.organizationId;
  const computed = await computeInsights(organizationId);
  await prisma.$transaction([
    prisma.insight.deleteMany({ where: { organizationId } }),
    prisma.insight.createMany({
      data: computed.map((i) => ({
        organizationId,
        type: i.type,
        severity: i.severity,
        customerId: i.customerId || null,
        customerName: i.customerName || null,
        productCode: i.productCode || null,
        message: i.message,
        metric: i.metric
      }))
    })
  ]);
  res.json({ ok: true, count: computed.length, generatedAt: new Date() });
});

router.delete('/', async (req, res) => {
  await prisma.insight.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

const EXPORT_COLUMNS = [
  { key: 'type', label: 'סוג תובנה' },
  { key: 'customerId', label: 'מספר לקוח' },
  { key: 'customerName', label: 'שם לקוח' },
  { key: 'productCode', label: 'קוד פריט' },
  { key: 'message', label: 'תיאור התובנה' },
  { key: 'severity', label: 'חומרה' },
  { key: 'metric', label: 'מדד' }
];

router.get('/export', async (req, res) => {
  const rows = await prisma.insight.findMany({ where: { organizationId: req.user.organizationId } });
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, sortInsights(rows));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="insights.xlsx"');
  res.send(buffer);
});

module.exports = router;
