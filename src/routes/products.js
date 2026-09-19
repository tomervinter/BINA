const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer } = require('../lib/csv');
const { parseListQuery } = require('../lib/listQuery');
const { rowsToXlsxBuffer } = require('../lib/xlsxExport');
const { replaceAll } = require('../lib/bulkInsert');
const { createJob, updateJob } = require('../lib/uploadJobs');
const upload = require('../lib/uploadMiddleware');
const { logAction } = require('../lib/auditLog');

const router = express.Router();

router.use(requireAuth);

const LIST_FIELDS = ['itemCode', 'name', 'type', 'superType', 'department', 'unit', 'status', 'forProcurement', 'forMarketing'];
const EXPORT_COLUMNS = [
  { key: 'itemCode', label: 'קוד פריט' },
  { key: 'name', label: 'שם פריט' },
  { key: 'type', label: 'טיפוס' },
  { key: 'superType', label: 'טיפוס על' },
  { key: 'department', label: 'מחלקה' },
  { key: 'unit', label: 'יחידת מידה למוצר' },
  { key: 'status', label: 'סטטוס מוצר' },
  { key: 'forProcurement', label: 'לעיתוד' },
  { key: 'forMarketing', label: 'לשיווק' }
];
const MAX_EXPORT_ROWS = 100000;

router.get('/', async (req, res) => {
  const { page, pageSize, sortBy, sortDir, where, skip, take } = parseListQuery(req, {
    sortableFields: LIST_FIELDS,
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'name', dir: 'asc' }
  });
  const fullWhere = { organizationId: req.user.organizationId, ...where };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where: fullWhere, orderBy: { [sortBy]: sortDir }, skip, take }),
    prisma.product.count({ where: fullWhere })
  ]);
  res.json({ rows, total, page, pageSize });
});

router.get('/export', async (req, res) => {
  const { sortBy, sortDir, where } = parseListQuery(req, {
    sortableFields: LIST_FIELDS,
    filterableFields: LIST_FIELDS,
    defaultSort: { field: 'name', dir: 'asc' }
  });
  const rows = await prisma.product.findMany({
    where: { organizationId: req.user.organizationId, ...where },
    orderBy: { [sortBy]: sortDir },
    take: MAX_EXPORT_ROWS
  });
  const buffer = rowsToXlsxBuffer(EXPORT_COLUMNS, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
  res.send(buffer);
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });

  const orgId = req.user.organizationId;
  const jobId = createJob(orgId);
  res.json({ jobId });

  // Parsing is itself real CPU-bound work — run here in the background alongside
  // the DB write (not just the DB write, as before), so the HTTP response never
  // waits on ANY of it. See sales.js's upload route for the fuller explanation.
  (async () => {
    let records;
    try {
      records = parseFileBuffer(req.file.buffer, req.file.originalname);
    } catch (err) {
      updateJob(jobId, { status: 'error', error: 'שגיאה בקריאת הקובץ — ודאו שזהו קובץ CSV או Excel תקין' });
      return;
    }
    if (!records.length) {
      updateJob(jobId, { status: 'error', error: 'הקובץ ריק' });
      return;
    }

    const rows = records.map((r) => ({
      organizationId: orgId,
      itemCode: String(r['קוד פריט'] || '').trim(),
      name: String(r['שם פריט'] || '').trim(),
      type: r['טיפוס'] || null,
      superType: r['טיפוס על'] || null,
      department: r['מחלקה'] || null,
      unit: r['יחידת מידה למוצר'] || null,
      status: r['סטטוס מוצר'] || 'פעיל',
      forProcurement: r['לעיתוד'] || null,
      forMarketing: r['לשיווק'] || null
    })).filter((r) => r.itemCode);

    logAction(req.user, 'product.upload', rows.length + ' שורות');
    try {
      await replaceAll(prisma, 'product', { organizationId: orgId }, rows);
      updateJob(jobId, { status: 'done', count: rows.length });
    } catch (err) {
      console.error('Products upload job failed:', jobId, err);
      updateJob(jobId, { status: 'error', error: 'שגיאה בשמירת הנתונים בבסיס הנתונים — נסו שוב או פנו לתמיכה' });
    }
  })();
});

router.delete('/', async (req, res) => {
  await prisma.product.deleteMany({ where: { organizationId: req.user.organizationId } });
  logAction(req.user, 'product.delete_all');
  res.json({ ok: true });
});

module.exports = router;
