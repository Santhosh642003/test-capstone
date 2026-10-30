// ONE real model call through the same code path as the import pipeline (runIngestion -> makeFoundryCaller ->
// runFoundryRequest, same system prompt, same contract prompt, same PDF file part), then the same parse / repair / validate.
//   npm run smoke:model                      # eval/pdfs/sample-isp-intake.pdf
//   npm run smoke:model -- path/to/blank.pdf # your own blank PDF (<= 5 pages: one call)
//   flags: --text-only (skip JSON mode), --allow-chunking (PDFs over 5 pages = several calls)
// Needs ONLY FOUNDRY_API_KEY + FOUNDRY_URL (+ optional FOUNDRY_LLM_MODEL). No SQL, no blob. Never prints the key.
process.env.FW_LOGGING_METHOD = 'console'; // running this must never upload/delete anything in the log container
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const pdfArg = args.find((a) => !a.startsWith('--'));
const pdfPath = path.resolve(pdfArg || path.join(__dirname, '..', 'eval', 'pdfs', 'sample-isp-intake.pdf'));

const line = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return '(invalid URL)'; } };

(async () => {
  const fi = require('../helpers/formIngestion');
  
  const apiKey = process.env.FOUNDRY_API_KEY;
  const baseUrl = process.env.FOUNDRY_URL;
  const model = process.env.FOUNDRY_LLM_MODEL || 'gpt-4.1';

  console.log('smoke:model - one real call through the ingestion pipeline\n');
  const missing = ['FOUNDRY_API_KEY', 'FOUNDRY_URL'].filter((n) => !process.env[n] || /^<.*>$/.test(process.env[n]));
  if (missing.length) {
    console.log(`NOT RUN: missing ${missing.join(', ')}. Put them in fieldworker/.env (see .env.example) and run "npm run check:env".`);
    process.exit(2);
  }
  if (!fs.existsSync(pdfPath)) { console.log(`NOT RUN: PDF not found: ${pdfPath}`); process.exit(2); }
  const pdf = fs.readFileSync(pdfPath);

  let pages;
  try { ({ pages } = await fi.precheckPdf(pdf)); } catch (e) { console.log(`NOT RUN: pre-check refused this PDF (${e.code || 'error'}): ${e.message}`); process.exit(2); }
  if (pages > fi.CHUNK_PAGES && !flag('--allow-chunking')) {
    console.log(`NOT RUN: this PDF has ${pages} pages, so the pipeline would make ${Math.ceil(pages / fi.CHUNK_PAGES)} model calls. The smoke test is meant to be ONE call; use a PDF of ${fi.CHUNK_PAGES} pages or fewer, or pass --allow-chunking.`);
    process.exit(2);
  }

  line('PDF', `${path.basename(pdfPath)} (${pages} pages, ${(pdf.length / 1024).toFixed(0)} KB)`);
  line('Endpoint host', hostOf(baseUrl));
  line('Deployment (model)', model);
  line('Requested mode', flag('--text-only') ? 'text only (JSON mode skipped)' : 'JSON mode + PDF file part (falls back to text if rejected)');
  console.log('');

  const real = fi.makeFoundryCaller({ apiKey, baseUrl, model, jsonMode: !flag('--text-only') });
  const calls = [];
  const callModel = async (req) => {
    const t0 = Date.now();
    const rec = { label: req.label, ms: null, mode: null, fallback: null, parsed: null, usage: null };
    calls.push(rec);
    try {
      const out = await real(req);
      rec.ms = Date.now() - t0; rec.mode = out.mode; rec.fallback = out.fallback; rec.usage = out.usage;
      try { fi.parseJsonFromLlmContent(out.content); rec.parsed = true; } catch (e) { rec.parsed = false; }
      return out;
    } catch (e) { rec.ms = Date.now() - t0; rec.error = e; throw e; }
  };

  const t0 = Date.now();
  let result;
  try {
    result = await fi.runIngestion(pdf, { filename: path.basename(pdfPath), model, callModel, log: () => {} });
  } catch (err) {
    const info = fi.describeFoundryError(err);
    console.log('RESULT: FAILURE');
    line('Error class', info.errorClass);
    line('HTTP status', info.status === null ? 'n/a' : String(info.status));
    line('Message', fi.scrub(err.message, apiKey).slice(0, 300));
    console.log(`\nWhat to fix: ${info.hint}`);
    const last = calls[calls.length - 1];
    if (last && last.fallback) line('JSON mode', `was rejected first (${last.fallback.status} ${last.fallback.errorClass}) and the text-mode retry also failed`);
    process.exit(1);
  }

  const first = calls[0] || {};
  const p = result.usage.promptTokens; const c = result.usage.completionTokens;
  console.log(`RESULT: ${result.problems.length === 0 ? 'SUCCESS' : 'MODEL ANSWERED, BUT THE DRAFT HAS VALIDATION PROBLEMS'}`);
  line('Mode that worked', first.mode === 'json' ? 'JSON mode (response_format json_object) together with the PDF file part' : 'text mode (JSON requested in the prompt only)');
  if (first.fallback) line('JSON mode fallback', `rejected with HTTP ${first.fallback.status} (${first.fallback.errorClass}): ${fi.scrub(first.fallback.message, apiKey).slice(0, 200)}`);
  line('Model calls', `${calls.length}${calls.length > 1 ? ` (first: ${calls[0].label}; extra calls are chunks or the repair pass)` : ''}${calls.some((x) => x.fallback) ? ' - plus 1 rejected JSON-mode HTTP request retried in text mode' : ''}`);
  line('Latency', `${calls.map((x) => `${(x.ms / 1000).toFixed(1)}s`).join(' + ')} (total incl. repair/validate ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  line('Tokens', `prompt ${p}, completion ${c}, total ${p + c}${pages ? ` (~${Math.round((p + c) / pages)} per page)` : ''}`);
  line('Output parsed as JSON', calls.every((x) => x.parsed) ? 'yes' : 'NO for at least one call');
  line('Passes Form.io subset', result.problems.length === 0 ? 'yes (0 validator errors)' : `NO (${result.problems.length} validator errors)`);
  line('Fields in draft', String(result.fields.length));
  line('Auto-repairs applied', String(result.usage.repaired));
  const flagged = result.fields.filter((f) => f.flags.length || (f.confidence !== null && f.confidence < 0.85) || f.notes).length;
  line('Fields needing review', `${flagged} (low model confidence, notes, or heuristic flags)`);
  if (result.problems.length) { console.log('\nValidator errors:'); result.problems.slice(0, 15).forEach((e) => console.log(`  - ${e}`)); }
  console.log('\n(This checks plumbing, not accuracy. For scores run: npm run eval:forms)');
  process.exit(result.problems.length === 0 ? 0 : 4);
})().catch((e) => { console.log(`UNEXPECTED ERROR: ${String(e.message).slice(0, 300)}`); process.exit(1); });
