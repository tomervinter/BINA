const express = require('express');
const prisma = require('../lib/prisma');
const requireAuth = require('../middleware/requireAuth');
const { loadContext, getCellState } = require('../lib/relevanceEngine');

const router = express.Router();
router.use(requireAuth);

function uniqueNames(rows) {
  const seen = {}, out = [];
  rows.forEach((r) => {
    const k = String(r.name || '').trim();
    if (!k || seen[k]) return;
    seen[k] = true;
    out.push(k);
  });
  return out;
}

// Products x { holiday names, season names } matrix with the computed relevance state for each cell.
router.get('/matrix', async (req, res) => {
  const ctx = await loadContext(req.user.organizationId);
  const events = []
    .concat(uniqueNames(ctx.holidays).map((name) => ({ source: 'holiday', name })))
    .concat(uniqueNames(ctx.seasons).map((name) => ({ source: 'season', name })));

  const matrix = ctx.products.map((p) => ({
    productCode: p.itemCode,
    productName: p.name,
    cells: events.map((ev) => ({ source: ev.source, name: ev.name, state: getCellState(ctx, p.itemCode, ev.source, ev.name) }))
  }));

  res.json({ events, matrix });
});

router.put('/', async (req, res) => {
  const { productCode, source, name, value } = req.body || {};
  if (!productCode || (source !== 'holiday' && source !== 'season') || !name || typeof value !== 'boolean') {
    return res.status(400).json({ error: 'קלט לא תקין' });
  }
  const orgId = req.user.organizationId;
  await prisma.relevanceOverride.upsert({
    where: { organizationId_productCode_source_name: { organizationId: orgId, productCode, source, name } },
    create: { organizationId: orgId, productCode, source, name, value },
    update: { value }
  });
  res.json({ ok: true });
});

router.delete('/', async (req, res) => {
  const { productCode, source, name } = req.body || {};
  if (!productCode || !source || !name) return res.status(400).json({ error: 'קלט לא תקין' });
  await prisma.relevanceOverride.deleteMany({
    where: { organizationId: req.user.organizationId, productCode, source, name }
  });
  res.json({ ok: true });
});

module.exports = router;
