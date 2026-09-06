const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

// Directional substitute list: productCode -> substituteCode. Both codes must exist
// in the current product master (validated against Product, not FK-enforced, since
// products are wholesale-replaced on every master upload).
router.get('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const [rows, products] = await Promise.all([
    prisma.productSubstitute.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } }),
    prisma.product.findMany({ where: { organizationId }, select: { itemCode: true, name: true } })
  ]);
  const nameByCode = {};
  products.forEach((p) => { nameByCode[p.itemCode] = p.name; });
  res.json(rows.map((r) => ({
    id: r.id,
    productCode: r.productCode,
    productName: nameByCode[r.productCode] || r.productCode,
    substituteCode: r.substituteCode,
    substituteName: nameByCode[r.substituteCode] || r.substituteCode
  })));
});

router.post('/', async (req, res) => {
  const organizationId = req.user.organizationId;
  const productCode = String((req.body || {}).productCode || '').trim();
  const substituteCode = String((req.body || {}).substituteCode || '').trim();
  if (!productCode || !substituteCode) return res.status(400).json({ error: 'יש לבחור מוצר ומוצר תחליפי' });
  if (productCode === substituteCode) return res.status(400).json({ error: 'מוצר לא יכול להיות תחליף לעצמו' });

  const [product, substitute] = await Promise.all([
    prisma.product.findFirst({ where: { organizationId, itemCode: productCode } }),
    prisma.product.findFirst({ where: { organizationId, itemCode: substituteCode } })
  ]);
  if (!product) return res.status(400).json({ error: 'המוצר הראשי לא נמצא בטבלת המוצרים' });
  if (!substitute) return res.status(400).json({ error: 'המוצר התחליפי לא נמצא בטבלת המוצרים' });

  try {
    const row = await prisma.productSubstitute.create({ data: { organizationId, productCode, substituteCode } });
    res.json({ id: row.id, productCode, productName: product.name, substituteCode, substituteName: substitute.name });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'ההתאמה הזו כבר קיימת' });
    throw err;
  }
});

router.delete('/:id', async (req, res) => {
  const existing = await prisma.productSubstitute.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!existing) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  await prisma.productSubstitute.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

module.exports = router;
