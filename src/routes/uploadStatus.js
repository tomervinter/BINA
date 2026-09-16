const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getJob } = require('../lib/uploadJobs');

const router = express.Router();
router.use(requireAuth);

// Polled by upload-widget.js after a '/upload' route hands off to a background job.
router.get('/:jobId', (req, res) => {
  const job = getJob(req.params.jobId, req.user.organizationId);
  if (!job) return res.status(404).json({ error: 'המשימה לא נמצאה — ייתכן שהשרת הופעל מחדש באמצע העיבוד, נסו להעלות את הקובץ שוב' });
  res.json({ status: job.status, count: job.count, error: job.error });
});

module.exports = router;
