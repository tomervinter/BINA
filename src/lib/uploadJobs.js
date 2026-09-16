// In-memory tracker for async file-upload jobs. The '/upload' routes (sales/customers/
// products/inventory) respond as soon as the file is parsed and hand the actual
// database write off to one of these jobs, so a large file's slow bulk insert never
// has to finish inside the original HTTP request/response cycle (which is what was
// timing out on production for big sales exports). The frontend polls
// GET /api/upload-status/:jobId (see routes/uploadStatus.js) until it's done.
//
// Single Node process is assumed — a container restart mid-job loses the entry, which
// the polling endpoint reports as 404 and the frontend treats as a clear error rather
// than polling forever.
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function createJob(organizationId) {
  const jobId = 'up_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  jobs.set(jobId, { organizationId, status: 'processing', count: null, error: null, createdAt: Date.now() });
  return jobId;
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (job) Object.assign(job, patch);
}

function getJob(jobId, organizationId) {
  const job = jobs.get(jobId);
  return job && job.organizationId === organizationId ? job : null;
}

// Sweeps stale entries periodically so a long-running process doesn't leak memory.
setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  jobs.forEach((job, id) => { if (job.createdAt < cutoff) jobs.delete(id); });
}, 10 * 60 * 1000).unref();

module.exports = { createJob, updateJob, getJob };
