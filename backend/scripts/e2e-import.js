// End-to-end check of the import API: upload a PDF to POST /import, poll GET /import/:jobId, print the final status.
//   npm run e2e:import                          # in-process: serves routes/form_import.js on a random local port (dev auth bypass)
//   npm run e2e:import -- path/to/blank.pdf
//   npm run e2e:import -- --url https://host/api/fieldworker/task_form/import --token <MSAL access token>   # a running API
//   npm run e2e:import -- --with-blob           # also store the source PDF in FORM_IMPORT_CONTAINER_NAME (WRITES to blob)
//
// In-process mode needs only the Azure OpenAI vars, FW_ENV=dev (or test) and nothing else: it does not load the SQL
// module, never calls publish, and skips blob storage unless --with-blob. It enables DEV_AUTH_BYPASS for this process
// only, and refuses to run under NODE_ENV=production or FW_ENV=prod. Run smoke:model first.
process.env.FW_LOGGING_METHOD = 'console'; // never upload/delete anything in the log container from this script
const fs = require('fs');
const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const pdfArg = args.find((a, i) => !a.startsWith('--') && !['--url', '--token'].includes(args[i - 1]));
const pdfPath = path.resolve(pdfArg || path.join(__dirname, '..', 'eval', 'pdfs', 'sample-isp-intake.pdf'));
const remoteUrl = opt('--url');
const token = opt('--token');
const withBlob = args.includes('--with-blob');
const skipped = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (msg, code = 1) => { console.log(msg); process.exit(code); };

(async () => {
  console.log('e2e:import - upload -> poll -> result\n');
  if (!fs.existsSync(pdfPath)) fail(`NOT RUN: PDF not found: ${pdfPath}`, 2);
  const pdf = fs.readFileSync(pdfPath);
  let base;
  let headers = {};
  let server;

  if (remoteUrl) {
    if (!token) fail('NOT RUN: --url needs --token <MSAL access token> (or start that API with DEV_AUTH_BYPASS=true and FW_ENV=dev and pass --token x).', 2);
    base = remoteUrl.replace(/\/+$/, '');
    headers = { Authorization: `Bearer ${token}` };
    console.log(`  mode: calling a running API at ${new URL(base).host}`);
    skipped.push('server-side steps (blob, auth, SQL) are whatever that API is configured for');
  } else {
    const missing = ['FOUNDRY_API_KEY', 'FOUNDRY_URL'].filter((n) => !process.env[n] || /^<.*>$/.test(process.env[n]));
    if (missing.length) fail(`NOT RUN: missing ${missing.join(', ')}. Run "npm run check:env" and "npm run smoke:model" first.`, 2);
    if (process.env.NODE_ENV === 'production' || !process.env.FW_ENV || process.env.FW_ENV === 'prod') {
      fail('NOT RUN: the dev auth bypass used by in-process mode is refused when NODE_ENV=production or FW_ENV is prod/unset. Set FW_ENV=dev in .env.', 2);
    }
    process.env.DEV_AUTH_BYPASS = 'true'; // this process only; must be set before the handlers are loaded
    const express = require('express');  
    const importHelpers = require('../helpers/form_import');
  
    if (!withBlob) { importHelpers.deps.uploadSource = async () => null; skipped.push('blob upload of the source PDF (pass --with-blob to store it; that WRITES to FORM_IMPORT_CONTAINER_NAME)'); }
    else if (!process.env.BLOB_KEY || !process.env.FORM_IMPORT_CONTAINER_NAME) skipped.push('blob upload (BLOB_KEY / FORM_IMPORT_CONTAINER_NAME not set; the PDF is not stored)');
    const app = express();
    app.use('/import', require('../routes/form_import'));  
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/import`;
    console.log(`  mode: in-process API on ${base} (DEV_AUTH_BYPASS on, this process only)`);
    skipped.push('SQL: the import path does not use the database; publish (POST /import/publish) is NOT called');
  }
  console.log(`  PDF:  ${path.basename(pdfPath)} (${(pdf.length / 1024).toFixed(0)} KB)\n`);

  const t0 = Date.now();
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), path.basename(pdfPath));
  let res;
  try { res = await fetch(base, { method: 'POST', headers, body: form }); } catch (e) { fail(`FAILURE: could not reach ${base}: ${e.message}`); }
  const body = await res.json().catch(() => ({}));
  console.log(`POST /import -> HTTP ${res.status} ${body.jobId ? `jobId ${body.jobId}` : JSON.stringify(body).slice(0, 200)}`);
  if (res.status !== 202) {
    const hint = { 401: 'Token missing/invalid for this API (or bypass not enabled there).', 403: `The caller is not an MIS administrator (company must be MIS_COMPANY_ID=${process.env.MIS_COMPANY_ID || 2000}).`, 413: 'PDF too large (20 MB).', 415: 'Not a PDF.', 422: 'Pre-check refused the PDF (see message).', 429: 'Too many imports running; retry.', 500: 'Server not configured (see message).' }[res.status];
    fail(`FAILURE${hint ? `: ${hint}` : ''}`);
  }

  let last = '';
  let view;
  const deadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    const r = await fetch(`${base}/${body.jobId}`, { headers });
    view = await r.json().catch(() => ({}));
    const stage = `${view.status}${view.stage ? ` - ${view.stage}` : ''}${view.progress !== undefined ? ` (${view.progress}%)` : ''}`;
    if (stage !== last) { console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${stage}`); last = stage; }
    if (view.status === 'done' || view.status === 'failed' || r.status !== 200) break;
    if (Date.now() > deadline) fail('FAILURE: timed out after 5 minutes of polling.');
    await sleep(1000);
  }

  console.log('');
  let code = 0;
  if (view.status === 'done') {
    const { result } = view;
    const fieldCount = result.fields.length;
    console.log(`RESULT: ${result.problems.length ? 'DONE WITH VALIDATION PROBLEMS' : 'SUCCESS'}`);
    console.log('  final status        done');
    console.log(`  fields in draft     ${fieldCount}`);
    console.log(`  validator errors    ${result.problems.length}`);
    console.log(`  JSON mode           ${result.usage.jsonMode}`);
    console.log(`  tokens              prompt ${result.usage.promptTokens}, completion ${result.usage.completionTokens}`);
    console.log(`  server-side time    ${result.usage.seconds}s (wall clock ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (result.problems.length) { result.problems.slice(0, 10).forEach((p) => console.log(`    - ${p}`)); code = 4; }
  } else {
    console.log('RESULT: FAILURE');
    console.log(`  final status        ${view.status || `HTTP error ${JSON.stringify(view).slice(0, 120)}`}`);
    console.log(`  message             ${view.error || view.message || ''}`);
    code = 1;
  }

  console.log('\nSkipped / not exercised:');
  skipped.forEach((s) => console.log(`  - ${s}`));
  console.log('  - database migration db/mssql/002_form_packs.sql was NOT run (run "npm run check:env" to see the exact command and target database)');
  if (server) server.close();
  process.exit(code);
})().catch((e) => fail(`UNEXPECTED ERROR: ${String(e.message).slice(0, 300)}`));
