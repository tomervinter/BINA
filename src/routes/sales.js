const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer, parseDMY, parseNumber } = require('../lib/csv');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

router.get('/', async (req, res) => {
  const rows = await prisma.sale.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: { date: 'desc' },
    take: 2000
  });
  res.json(rows);
});

router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });
  let records;
  try {
    records = parseFileBuffer(req.file.buffer, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ error: 'שגיאה בקריאת הקובץ — ודאו שזהו קובץ CSV או Excel תקין' });
  }
  if (!records.length) return res.status(400).json({ error: 'הקובץ ריק' });

  const orgId = req.user.organizationId;
  const rows = records.map((r) => {
    const date = parseDMY(r['תאריך']);
    return {
      organizationId: orgId,
      customerNumber: String(r['מספר לקוח'] || '').trim(),
      productCode: String(r['קוד פריט'] || '').trim(),
      date: date || new Date(0),
      quantity: parseNumber(r['מכר כמותי']),
      revenue: parseNumber(r['מכר כספי']),
      weight: r['משקל'] != null ? parseNumber(r['משקל']) : null
    };
  }).filter((r) => r.customerNumber && r.productCode && r.date.getTime() !== new Date(0).getTime());

  await prisma.$transaction([
    prisma.sale.deleteMany({ where: { organizationId: orgId } }),
    prisma.sale.createMany({ data: rows })
  ]);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.sale.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
