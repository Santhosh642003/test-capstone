// In-process job store for PDF imports. A model call can take longer than the App Service request
// ceiling (230 s), so POST /task_form/import returns a jobId and the UI polls GET /task_form/import/:id.
// Jobs live in memory only (a restart loses in-flight jobs; the UI shows "failed" and the engineer
// re-uploads) and are dropped after TTL_MS. Move to a table if jobs must survive restarts.
const crypto = require('crypto');

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_RUNNING = 3;
const jobs = new Map();

const sweep = () => {
  const now = Date.now();
  jobs.forEach((j, id) => { if (now - j.createdAt > TTL_MS) jobs.delete(id); });
};

const runningCount = () => [...jobs.values()].filter((j) => j.status === 'running').length;

const createJob = ({ filename, employeeId, companyId, blobUrl }) => {
  sweep();
  if (runningCount() >= MAX_RUNNING) {
    const err = new Error('Too many imports are running. Please try again in a minute.');
    err.code = 'BUSY';
    throw err;
  }
  const jobId = crypto.randomUUID();
  jobs.set(jobId, { jobId, status: 'running', stage: null, progress: 0, filename, employeeId, companyId, blobUrl, createdAt: Date.now() });
  return jobId;
};

const updateJob = (jobId, patch) => { const j = jobs.get(jobId); if (j) Object.assign(j, patch); };
const getJob = (jobId) => jobs.get(jobId) || null;

// What the client may see: never the owner ids or the blob URL.
const publicView = (job) => {
  if (!job) return null;
  const { status, stage, progress, error, result } = job;
  if (status === 'done') return { status, result };
  if (status === 'failed') return { status, error };
  return { status, stage, progress };
};

module.exports = { createJob, updateJob, getJob, publicView, __reset: () => jobs.clear() };
