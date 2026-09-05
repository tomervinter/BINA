const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { parseFileBuffer } = require('../lib/csv');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

router.get('/', async (req, res) => {
  const rows = await prisma.product.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: { name: 'asc' }
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

  await prisma.$transaction([
    prisma.product.deleteMany({ where: { organizationId: orgId } }),
    prisma.product.createMany({ data: rows })
  ]);

  res.json({ ok: true, count: rows.length });
});

router.delete('/', async (req, res) => {
  await prisma.product.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
