// Local LIVE import API for demos: serves ONLY the import routes (POST /import, GET /import/:jobId) so the MIS front end
// can send a real PDF to the real Azure OpenAI model.
//   npm run serve:import          # then, in frontend/:  npm run start:live
// Needs only FOUNDRY_API_KEY + FOUNDRY_URL (+ optional FOUNDRY_LLM_MODEL) and FW_ENV=dev (or test) in .env.
// Safety: listens on 127.0.0.1 only; allows browser calls only from localhost:3000; uses the dev-only auth bypass for THIS
// process (refused when NODE_ENV=production or FW_ENV=prod/unset); never uses SQL; never stores the PDF in blob storage;
// publish is not served. Never prints the key.
process.env.FW_LOGGING_METHOD = 'console'; // never upload/delete anything in the log container
const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const missing = ['FOUNDRY_API_KEY', 'FOUNDRY_URL'].filter((n) => !process.env[n] || /^<.*>$/.test(process.env[n]));
if (missing.length) { console.log(`NOT STARTED: missing ${missing.join(', ')}. Run "npm run check:env".`); process.exit(2); }
if (process.env.NODE_ENV === 'production' || !process.env.FW_ENV || process.env.FW_ENV === 'prod') {
  console.log('NOT STARTED: the dev auth bypass is refused when NODE_ENV=production or FW_ENV is prod/unset. Set FW_ENV=dev in .env.');
  process.exit(2);
}
process.env.DEV_AUTH_BYPASS = 'true'; // this process only; must be set before the handlers are loaded

const express = require('express'); // eslint-disable-line global-require
const cors = require('cors'); // eslint-disable-line global-require
const importHelpers = require('../helpers/form_import'); // eslint-disable-line global-require

importHelpers.deps.uploadSource = async () => null; // demos never write the PDF to blob storage
const PORT = Number(process.env.IMPORT_PORT) || 4000;
const app = express();
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use('/api/fieldworker/task_form/import', require('../routes/form_import')); // eslint-disable-line global-require
app.get('/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
server.on('error', (e) => {
  console.log(e.code === 'EADDRINUSE' ? `NOT STARTED: port ${PORT} is already in use (is the import API already running?). Stop the other process or set IMPORT_PORT=<free port> (and REACT_APP_LIVE_API to match).` : `NOT STARTED: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  let host = '(unknown)';
  try { host = new URL(process.env.FOUNDRY_URL).host; } catch (e) { /* keep placeholder */ }
  console.log(`Live import API ready on http://localhost:${PORT}/api/fieldworker/task_form/import`);
  console.log(`  model deployment: ${process.env.FOUNDRY_LLM_MODEL || 'gpt-4.1'} at ${host}`);
  console.log('  dev auth bypass ON, localhost only, no SQL, PDFs not stored. Ctrl+C to stop.');
});
