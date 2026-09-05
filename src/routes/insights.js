const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { computeInsights } = require('../lib/insightsEngine');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const insights = await computeInsights(req.user.organizationId);
  res.json(insights);
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
  const insights = await computeInsights(req.user.organizationId);
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, insights);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="insights.xlsx"');
  res.send(buffer);
});

module.exports = router;
