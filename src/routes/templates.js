const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { headerOnlyXlsxBuffer } = require('../lib/xlsxExport');
const ENTITY_HEADERS = require('../lib/entitySchemas');

const router = express.Router();
router.use(requireAuth);

router.get('/:entity', (req, res) => {
  const headers = ENTITY_HEADERS[req.params.entity];
  if (!headers) return res.status(404).json({ error: 'סוג קובץ לא מוכר' });
  const buffer = headerOnlyXlsxBuffer(headers);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-template.xlsx"`);
  res.send(buffer);
});

module.exports = router;
