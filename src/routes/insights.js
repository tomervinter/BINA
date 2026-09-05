const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { computeInsights } = require('../lib/insightsEngine');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const insights = await computeInsights(req.user.organizationId);
  res.json(insights);
});

module.exports = router;
