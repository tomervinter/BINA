const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { DEFAULT_PARAMS, loadParams } = require('../lib/insightsEngine');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const params = await loadParams(req.user.organizationId);
  res.json({ defaults: DEFAULT_PARAMS, values: params });
});

router.put('/:paramId', async (req, res) => {
  const { paramId } = req.params;
  const { value } = req.body || {};
  if (!(paramId in DEFAULT_PARAMS)) return res.status(400).json({ error: 'פרמטר לא מוכר' });
  const num = Number(value);
  if (isNaN(num)) return res.status(400).json({ error: 'ערך לא תקין' });

  const orgId = req.user.organizationId;
  await prisma.ruleSetting.upsert({
    where: { organizationId_paramId: { organizationId: orgId, paramId } },
    update: { value: num },
    create: { organizationId: orgId, paramId, value: num }
  });
  res.json({ ok: true });
});

router.delete('/', async (req, res) => {
  await prisma.ruleSetting.deleteMany({ where: { organizationId: req.user.organizationId } });
  res.json({ ok: true });
});

module.exports = router;
