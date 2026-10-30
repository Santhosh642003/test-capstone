// Eval harness (US-7): runs the ingestion pipeline over eval/pdfs/*.pdf, scores each result against the
// hand-built eval/gold/<same name>.json, prints a Markdown table and writes eval/results/<promptVersion>.md.
//
//   npm run eval:forms                 real model (needs FOUNDRY_API_KEY + FOUNDRY_URL; optional FOUNDRY_LLM_MODEL)
//   npm run eval:forms -- --replay     no network: replays eval/replay/<name>.json (a saved model reply) -- checks the
//                                      harness itself; the scores say nothing about model quality
//   npm run eval:forms -- --only name  one PDF
//
// Commit eval/results/ together with the prompt version it was produced with. No secrets are ever written to it.
process.env.FW_LOGGING_METHOD = 'console'; // never upload/delete anything in the log container from an eval run
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { scoreForm } = require('./evalMetrics');

const ROOT = path.join(__dirname, '..', 'eval');
const args = process.argv.slice(2);
const replay = args.includes('--replay');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const SAMPLE_NAME = 'sample-isp-intake'; // the fictional demo form shipped with the repo

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const avg = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return 'n/a'; } };

(async () => {
  const fi = require('../helpers/formIngestion');
  
  const apiKey = process.env.FOUNDRY_API_KEY;
  const baseUrl = process.env.FOUNDRY_URL;
  const deployment = replay ? 'n/a (replay)' : (process.env.FOUNDRY_LLM_MODEL || 'gpt-4.1');

  if (!replay) {
    const missing = ['FOUNDRY_API_KEY', 'FOUNDRY_URL'].filter((n) => !process.env[n] || /^<.*>$/.test(process.env[n]));
    if (missing.length) { console.log(`NOT RUN: missing ${missing.join(', ')}. Run "npm run check:env", then "npm run smoke:model" first.`); process.exit(2); }
  }

  const modes = new Set();
  const makeCaller = (name) => {
    if (replay) {
      const file = path.join(ROOT, 'replay', `${name}.json`);
      return async () => ({ content: fs.readFileSync(file, 'utf8'), usage: { prompt_tokens: 0, completion_tokens: 0 }, mode: 'replay' });
    }
    const real = fi.makeFoundryCaller({ apiKey, baseUrl, model: deployment });
    return async (req) => { const out = await real(req); modes.add(out.mode); return out; };
  };

  const names = fs.readdirSync(path.join(ROOT, 'pdfs')).filter((f) => f.endsWith('.pdf')).map((f) => f.replace(/\.pdf$/, '')).filter((n) => !only || n === only);
  const rows = [];
  for (const name of names) {
    const goldFile = path.join(ROOT, 'gold', `${name}.json`);
    if (!fs.existsSync(goldFile)) { console.log(`skip ${name}: no gold file`); continue; }
    const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
    try {
      const r = await fi.runIngestion(fs.readFileSync(path.join(ROOT, 'pdfs', `${name}.pdf`)), { filename: `${name}.pdf`, model: deployment, callModel: makeCaller(name) });
      const s = scoreForm(r.definition, gold);
      rows.push({ name, pages: r.usage.pages, ...s, valid: s.structurallyValid && r.problems.length === 0, tokens: r.usage.promptTokens + r.usage.completionTokens, seconds: r.usage.seconds });
    } catch (e) {
      const info = fi.describeFoundryError(e);
      rows.push({ name, error: `${info.errorClass}${info.status ? ` HTTP ${info.status}` : ''}: ${fi.scrub(e.message, apiKey).slice(0, 120)}`, hint: info.hint });
    }
  }

  const ok = rows.filter((r) => !r.error);
  const onlySample = rows.length > 0 && rows.every((r) => r.name === SAMPLE_NAME);
  const goldNote = onlySample
    ? 'The gold set is a SINGLE FICTIONAL form (`sample-isp-intake`, written for the demo, not an official state form). These numbers show the pipeline and harness work end to end; they are NOT a claim about accuracy on real state forms.'
    : `The gold set has ${rows.length} form(s) (see eval/gold). Treat the numbers as indicative only until it covers real forms from several agencies.`;
  const lines = [
    `# Form ingestion eval — prompt ${fi.PROMPT_VERSION}${replay ? ' (REPLAY: harness check only, not a model result)' : ''}`,
    '',
    `- **Date:** ${new Date().toISOString().slice(0, 10)}`,
    `- **Deployment (model):** ${deployment}${replay ? '' : ` at ${hostOf(baseUrl)}`}`,
    `- **JSON mode:** ${replay ? 'n/a (replay)' : [...modes].join(', ') || 'n/a (no successful call)'}`,
    `- **Forms evaluated:** ${rows.length} (${ok.length} scored)`,
    '- **Match rule:** label similarity ≥ 0.8, one-to-one',
    `- **Caveat:** ${goldNote}`,
    '',
    '| Form | Pages | Field recall | Precision | Type acc. | Option acc. | Required acc. | Valid | Tokens | Tokens/page | Sec |',
    '|---|---:|---:|---:|---:|---:|---:|:-:|---:|---:|---:|',
    ...rows.map((r) => (r.error
      ? `| ${r.name} | | ERROR: ${r.error} | | | | | | | | |`
      : `| ${r.name} | ${r.pages} | ${pct(r.recall)} | ${pct(r.precision)} | ${pct(r.typeAccuracy)} | ${pct(r.optionAccuracy)} | ${pct(r.requiredAccuracy)} | ${r.valid ? '✓' : '✗'} | ${r.tokens} | ${Math.round(r.tokens / r.pages)} | ${r.seconds} |`)),
    `| **Mean** | | **${pct(avg(ok.map((r) => r.recall)))}** | ${pct(avg(ok.map((r) => r.precision)))} | **${pct(avg(ok.map((r) => r.typeAccuracy)))}** | ${pct(avg(ok.map((r) => r.optionAccuracy)))} | ${pct(avg(ok.map((r) => r.requiredAccuracy)))} | ${ok.filter((r) => r.valid).length}/${ok.length} | ${ok.reduce((a, r) => a + r.tokens, 0)} | | |`,
    '',
    'Targets (project brief): field recall ≥ 85%, type accuracy ≥ 90%, 100% valid.',
    '',
    ...ok.filter((r) => r.missing.length).map((r) => `**${r.name}** — gold fields not found: ${r.missing.join('; ')}`),
    ...rows.filter((r) => r.error).map((r) => `**${r.name}** — what to fix: ${r.hint}`),
  ];
  const out = lines.join('\n');
  console.log(out);
  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  const file = path.join(ROOT, 'results', `${fi.PROMPT_VERSION}${replay ? '-replay' : ''}.md`);
  fs.writeFileSync(file, `${out}\n`);
  console.log(`\nwrote ${path.relative(process.cwd(), file)}`);
  process.exit(rows.length > 0 && ok.length === rows.length ? 0 : 1);
})();
