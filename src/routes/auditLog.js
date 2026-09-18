const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');
const { parseListQuery } = require('../lib/listQuery');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

const LIST_FIELDS = ['action', 'userEmail'];
const EXPORT_COLUMNS = [
  { key: 'createdAt', label: 'תאריך ושעה' },
  { key: 'userEmail', label: 'בוצע על ידי' },
  { key: 'action', label: 'פעולה' },
  { key: 'details', label: 'פרטים' }
];
const MAX_EXPORT_ROWS = 100000;

router.get('/', async (req, res) => {
  const { page, pageSize, sortBy, sortDir, where, skip, take } = parseListQuery(req, {
    sortableFields: ['createdAt', 'action', 'userEmail'],
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'createdAt', dir: 'desc' }
  });
  const fullWhere = { organizationId: req.user.organizationId, ...where };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where: fullWhere, orderBy: { [sortBy]: sortDir }, skip, take }),
    prisma.auditLog.count({ where: fullWhere })
  ]);
  res.json({ rows, total, page, pageSize });
});

router.get('/export', async (req, res) => {
  const { sortBy, sortDir, where } = parseListQuery(req, {
    sortableFields: ['createdAt', 'action', 'userEmail'],
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'createdAt', dir: 'desc' }
  });
  const rows = await prisma.auditLog.findMany({
    where: { organizationId: req.user.organizationId, ...where },
    orderBy: { [sortBy]: sortDir },
    take: MAX_EXPORT_ROWS
  });
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.xlsx"');
  res.send(buffer);
});

module.exports = router;
