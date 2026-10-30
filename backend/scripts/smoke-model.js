// ONE real model call through the same code path as the import pipeline (runIngestion -> makeFoundryCaller ->
// runFoundryRequest, same system prompt, same contract prompt, same PDF file part), then the same parse / repair / validate.
//   npm run smoke:model                      # eval/pdfs/sample-isp-intake.pdf
//   npm run smoke:model -- path/to/blank.pdf # your own blank PDF (<= 5 pages: one call)
//   flags: --text-only (skip JSON mode), --allow-chunking (PDFs over 5 pages = several calls)
//          --out <file.json>  also write the draft Form.io definition, the per-field manifest (type, label, section, source
//                             page, confidence, notes, flags) and the list of auto-repairs to that file. Contains no secrets:
//                             no key, URL, headers or raw model text, and the file is scrubbed for the key before writing.
//          --runs N           call the model N times (2-10) on the same PDF and compare: per-run field count, flagged count,
//                             tokens and latency; labels that appear in some runs but not all; Jaccard overlap of the label sets
//                             between runs. With --out the combined result (every run's draft + the comparison) is written
//                             instead of a single draft. N calls cost N times the tokens.
// Needs ONLY FOUNDRY_API_KEY + FOUNDRY_URL (+ optional FOUNDRY_LLM_MODEL). No SQL, no blob. Never prints the key.
process.env.FW_LOGGING_METHOD = 'console'; // running this must never upload/delete anything in the log container
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const outIdx = args.indexOf('--out');
const outArg = outIdx === -1 ? null : args[outIdx + 1];
const runsIdx = args.indexOf('--runs');
const runsArg = runsIdx === -1 ? null : args[runsIdx + 1];
const runsN = runsIdx === -1 ? 1 : Number(runsArg);
const valueIdx = new Set([outIdx + 1, runsIdx + 1].filter((i) => i > 0));
const pdfArg = args.find((a, i) => !a.startsWith('--') && !valueIdx.has(i));
const pdfPath = path.resolve(pdfArg || path.join(__dirname, '..', 'eval', 'pdfs', 'sample-isp-intake.pdf'));

const line = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return '(invalid URL)'; } };

(async () => {
  const fi = require('../helpers/formIngestion');
  
  const apiKey = process.env.FOUNDRY_API_KEY;
  const baseUrl = process.env.FOUNDRY_URL;
  const model = process.env.FOUNDRY_LLM_MODEL || 'gpt-4.1';

  console.log(`smoke:model - ${runsN >= 2 ? `${runsN} real calls` : 'one real call'} through the ingestion pipeline\n`);
  const missing = ['FOUNDRY_API_KEY', 'FOUNDRY_URL'].filter((n) => !process.env[n] || /^<.*>$/.test(process.env[n]));
  if (missing.length) {
    console.log(`NOT RUN: missing ${missing.join(', ')}. Put them in fieldworker/.env (see .env.example) and run "npm run check:env".`);
    process.exit(2);
  }
  if (!fs.existsSync(pdfPath)) { console.log(`NOT RUN: PDF not found: ${pdfPath}`); process.exit(2); }
  if (runsIdx !== -1 && (!Number.isInteger(runsN) || runsN < 1 || runsN > 10)) { console.log(`NOT RUN: --runs needs a whole number from 1 to 10 (got "${runsArg}"). Each run is a separate model call.`); process.exit(2); }
  if (outIdx !== -1 && (!outArg || outArg.startsWith('--'))) { console.log('NOT RUN: --out needs a file path, e.g. --out draft.json'); process.exit(2); }
  if (outArg && /^\.env/.test(path.basename(outArg))) { console.log('NOT RUN: refusing to write the draft over an .env file.'); process.exit(2); }
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

  if (runsN >= 2) {
    const R = require('./smokeRuns');
  
    console.log(`Running ${runsN} times on the same PDF (${runsN} model calls${pages > fi.CHUNK_PAGES ? ' or more, the PDF is chunked' : ''}).\n`);
    const per = []; // one record per run, in order
    const labelRuns = []; // successful runs only
    const drafts = [];
    let aborted = null;
    console.log('  run  result   fields  flagged  tokens (prompt+completion)  latency  mode');
    for (let i = 1; i <= runsN; i += 1) {
      const calls = [];
      const callModel = async (req) => {
        const c0 = Date.now(); const rec = { ms: null, mode: null, fallback: null };
        calls.push(rec);
        try { const out = await real(req); rec.ms = Date.now() - c0; rec.mode = out.mode; rec.fallback = out.fallback; return out; } catch (e) { rec.ms = Date.now() - c0; throw e; }
      };
      const r0 = Date.now();
      try {
         
        const res = await fi.runIngestion(pdf, { filename: path.basename(pdfPath), model, callModel, log: () => {} });
        const flagged = res.fields.filter(R.isFlagged).length;
        const rec = {
          run: i, ok: true, fieldCount: res.fields.length, flaggedCount: flagged,
          promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens, totalTokens: res.usage.promptTokens + res.usage.completionTokens,
          latencyMs: Date.now() - r0, modelCalls: calls.length, jsonMode: res.usage.jsonMode, validatorErrors: res.problems.length, autoRepairs: res.repairLog.length,
        };
        per.push(rec);
        labelRuns.push({ run: i, labels: R.labelMap(res.fields) });
        drafts.push({
          run: i, validatorErrors: res.problems, definition: res.definition, autoRepairs: res.repairLog,
          manifest: res.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, section: f.section, sourcePage: f.sourcePage, confidence: f.confidence, notes: f.notes, flags: f.flags, inheritedFrom: f.inheritedFrom })),
        });
        console.log(`  ${String(i).padStart(3)}  ${(res.problems.length ? 'PROBLEMS' : 'ok').padEnd(8)} ${String(rec.fieldCount).padStart(6)}  ${String(flagged).padStart(7)}  ${`${rec.promptTokens}+${rec.completionTokens}=${rec.totalTokens}`.padEnd(26)}  ${`${(rec.latencyMs / 1000).toFixed(1)}s`.padStart(7)}  ${rec.jsonMode}`);
      } catch (err) {
        const info = fi.describeFoundryError(err);
        per.push({ run: i, ok: false, latencyMs: Date.now() - r0, errorClass: info.errorClass, status: info.status, hint: info.hint });
        console.log(`  ${String(i).padStart(3)}  FAILED   ${info.errorClass}${info.status ? ` HTTP ${info.status}` : ''}`);
        if ([401, 403, 404].includes(info.status) || info.errorClass === 'NotConfigured') { aborted = `stopped after run ${i}: ${info.hint}`; break; }
      }
    }

    const ok = per.filter((x) => x.ok);
    const cmp = R.compareRuns(labelRuns);
    console.log('');
    if (aborted) console.log(`NOTE: ${aborted}\n`);
    if (ok.length < 2) {
      console.log(`Cannot compare: only ${ok.length} run(s) succeeded (need at least 2).`);
    } else {
      const counts = ok.map((x) => x.fieldCount);
      line('Field count', `min ${Math.min(...counts)}, max ${Math.max(...counts)} across ${ok.length} runs`);
      line('Label overlap (Jaccard)', `mean ${cmp.overlap.mean.toFixed(3)}, min ${cmp.overlap.min.toFixed(3)}, max ${cmp.overlap.max.toFixed(3)}  (1.000 = identical label sets)`);
      console.log('\n  Pairwise overlap:');
      console.log(`        ${ok.map((x) => `run ${x.run}`.padStart(7)).join('')}`);
      cmp.overlap.pairwise.forEach((row, ri) => console.log(`  run ${String(ok[ri].run).padEnd(3)}${row.map((v) => v.toFixed(3).padStart(7)).join('')}`));
      console.log(`\n  Labels in some runs but not all (${cmp.someButNotAll.length}):`);
      if (!cmp.someButNotAll.length) console.log('    none: every run produced exactly the same labels');
      cmp.someButNotAll.forEach((e) => console.log(`    - "${e.label}"  in runs ${e.inRuns.join(',')}; missing from ${e.missingFromRuns.join(',')}`));
    }
    console.log('\n(Same PDF, same prompt, temperature 0: any difference above is model run-to-run variation. This is not an accuracy measurement.)');

    if (outArg) {
      const outPath = path.resolve(outArg);
      const combined = {
        note: 'Smoke-test output from repeated runs on one PDF. Plumbing/stability check, not an accuracy measurement. Contains no credentials.',
        generatedAt: new Date().toISOString(),
        promptVersion: fi.PROMPT_VERSION,
        deployment: model,
        pdf: path.basename(pdfPath),
        pages,
        runsRequested: runsN,
        runsSucceeded: ok.length,
        stoppedEarly: aborted,
        perRun: per,
        labelsInSomeRunsNotAll: cmp.someButNotAll,
        labelOverlapJaccard: cmp.overlap ? { comparedRuns: cmp.comparedRuns, pairwise: cmp.overlap.pairwise, mean: cmp.overlap.mean, min: cmp.overlap.min, max: cmp.overlap.max } : null,
        drafts,
      };
      const json = fi.scrub(JSON.stringify(combined, null, 2), apiKey);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${json}\n`);
      line('Combined output written', outPath);
    }
    process.exit(per.some((x) => !x.ok) ? 1 : per.some((x) => x.validatorErrors > 0) ? 4 : 0);
  }
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
  if (outArg) {
    const outPath = path.resolve(outArg);
    const draft = {
      note: 'Smoke-test output. Plumbing check on one PDF, not an accuracy measurement. Contains no credentials.',
      generatedAt: new Date().toISOString(),
      promptVersion: result.usage.promptVersion,
      deployment: model,
      jsonMode: result.usage.jsonMode,
      pdf: path.basename(pdfPath),
      pages: result.usage.pages,
      usage: { promptTokens: p, completionTokens: c, seconds: result.usage.seconds, modelCalls: calls.length },
      validatorErrors: result.problems,
      definition: result.definition,
      manifest: result.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, section: f.section, sourcePage: f.sourcePage, confidence: f.confidence, notes: f.notes, flags: f.flags })),
      autoRepairs: result.repairLog,
    };
    const json = fi.scrub(JSON.stringify(draft, null, 2), apiKey);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${json}\n`);
    line('Draft written to', outPath);
  }
  console.log('\n(This checks plumbing, not accuracy. For scores run: npm run eval:forms)');
  process.exit(result.problems.length === 0 ? 0 : 4);
})().catch((e) => { console.log(`UNEXPECTED ERROR: ${String(e.message).slice(0, 300)}`); process.exit(1); });
