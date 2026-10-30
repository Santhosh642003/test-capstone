// smoke-model.js --runs N: label comparison logic (pure) and the script end to end against a local server that plays Azure OpenAI.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { labelMap, compareRuns, jaccard, isFlagged } = require('../scripts/smokeRuns');

// ---------- pure helpers ----------
const f = (label, key = label) => ({ key, label });

test('labelMap: normalises, counts repeated labels separately, and identifies empty labels by key', () => {
  const m = labelMap([f('Date Signed', 'a'), f('date signed:', 'b'), f('', 'grid'), f('Name', 'n')]);
  assert.deepStrictEqual([...m.keys()], ['date signed#1', 'date signed#2', '(empty label) grid#1', 'name#1']);
  assert.strictEqual(m.get('date signed#2'), 'date signed: (#2)');
  assert.strictEqual(m.get('(empty label) grid#1'), '(empty label) grid');
});

test('compareRuns: some-but-not-all labels, pairwise Jaccard, mean/min/max', () => {
  const a = labelMap([f('A'), f('B'), f('C')]);
  const b = labelMap([f('A'), f('B')]);
  const c = labelMap([f('A'), f('B'), f('C'), f('D')]);
  const r = compareRuns([{ run: 1, labels: a }, { run: 2, labels: b }, { run: 3, labels: c }]);
  assert.deepStrictEqual(r.someButNotAll.map((e) => [e.label, e.inRuns, e.missingFromRuns]), [['C', [1, 3], [2]], ['D', [3], [1, 2]]]);
  assert.deepStrictEqual(r.overlap.pairwise[0], [1, 0.667, 0.75]);
  assert.strictEqual(r.overlap.pairwise[1][2], 0.5);
  assert.strictEqual(r.overlap.min, 0.5); assert.strictEqual(r.overlap.max, 0.75);
  assert.strictEqual(r.overlap.mean, 0.639); // (0.667 + 0.75 + 0.5) / 3
});

test('compareRuns: identical runs overlap 1.0 with nothing "some but not all"; a single run has no overlap figure', () => {
  const x = labelMap([f('A'), f('B')]);
  const r = compareRuns([{ run: 1, labels: x }, { run: 2, labels: labelMap([f('A'), f('B')]) }]);
  assert.deepStrictEqual(r.someButNotAll, []); assert.strictEqual(r.overlap.mean, 1);
  assert.strictEqual(compareRuns([{ run: 1, labels: x }]).overlap, null);
  assert.strictEqual(jaccard(new Map(), new Map()), 1);
});

test('isFlagged matches the single-run rule (flags, confidence < 0.85, or notes)', () => {
  assert.strictEqual(isFlagged({ flags: [], confidence: 0.9, notes: '' }), false);
  assert.strictEqual(isFlagged({ flags: ['x'], confidence: 0.9, notes: '' }), true);
  assert.strictEqual(isFlagged({ flags: [], confidence: 0.84, notes: '' }), true);
  assert.strictEqual(isFlagged({ flags: [], confidence: 0.9, notes: 'n' }), true);
  assert.strictEqual(isFlagged({ flags: [], confidence: null, notes: '' }), false);
});

// ---------- end to end ----------
const KEY = 'smoke-runs-test-key-0123456789abcdef-not-real';
const ROOT = path.join(__dirname, '..');
const GOLD = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'gold', 'sample-isp-intake.json'), 'utf8'));

const envelope = (variant) => {
  const def = JSON.parse(JSON.stringify(GOLD));
  if (variant === 'noDx') def.components[1].components = def.components[1].components.filter((c) => c.key !== 'dx');
  const fields = [];
  (function walk(cs) { cs.forEach((c) => { if (c.input) fields.push({ key: c.key, sourcePage: 1, confidence: c.key === 'county' ? 0.6 : 0.95, notes: '' }); if (c.components) walk(c.components); }); }(def.components));
  return JSON.stringify({ definition: def, fields });
};

// variants[i] is what the i-th request gets; status overrides turn a request into an HTTP error
const withServer = async (plan, fn) => {
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const step = plan[Math.min(n, plan.length - 1)]; n += 1;
      if (step.status) { res.writeHead(step.status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: `denied ${req.headers.authorization}` } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: envelope(step.variant) } }], usage: { prompt_tokens: 1000 + n, completion_tokens: 500 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/openai/v1`, () => n); } finally { server.close(); }
};
const runSmoke = (args, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smoke-model.js'), ...args], { env: { PATH: process.env.PATH, ...env }, cwd: ROOT });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

test('--runs 3 --out: per-run table, labels in some runs only, Jaccard overlap, combined file without secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-runs-'));
  const file = path.join(dir, 'combined.json');
  await withServer([{ variant: 'full' }, { variant: 'noDx' }, { variant: 'full' }], async (url, calls) => {
    const { code, out } = await runSmoke(['--runs', '3', '--out', file], { FOUNDRY_API_KEY: KEY, FOUNDRY_URL: url });
    assert.strictEqual(code, 0, out);
    assert.strictEqual(calls(), 3, 'one model call per run');
    assert.ok(!out.includes(KEY));
    assert.match(out, /Labels in some runs but not all \(1\)/);
    assert.match(out, /"Dx" {2}in runs 1,3; missing from 2/);
    assert.match(out, /mean 0\.965, min 0\.947, max 1\.000/);

    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(j.runsRequested, 3); assert.strictEqual(j.runsSucceeded, 3);
    assert.deepStrictEqual(j.perRun.map((r) => r.fieldCount), [19, 18, 19]);
    // county @ 0.6 is flagged in every run; "Dx" (2-character label) adds the short-label flag in runs 1 and 3 only
    assert.deepStrictEqual(j.perRun.map((r) => r.flaggedCount), [2, 1, 2]);
    assert.deepStrictEqual(j.perRun.map((r) => r.promptTokens), [1001, 1002, 1003]);
    assert.ok(j.perRun.every((r) => r.latencyMs >= 0 && r.totalTokens === r.promptTokens + r.completionTokens));
    assert.deepStrictEqual(j.labelsInSomeRunsNotAll, [{ label: 'Dx', inRuns: [1, 3], missingFromRuns: [2] }]);
    assert.strictEqual(j.labelOverlapJaccard.mean, 0.965);
    assert.deepStrictEqual(j.labelOverlapJaccard.pairwise[0], [1, 0.947, 1]);
    assert.strictEqual(j.drafts.length, 3);
    assert.ok(j.drafts[1].definition.components.length && j.drafts[1].manifest.length === 18);
    const text = fs.readFileSync(file, 'utf8');
    [KEY, 'Authorization', 'Bearer', '127.0.0.1'].forEach((s) => assert.ok(!text.includes(s), `file contains ${s}`));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--runs: an auth failure stops the loop after the first call and nothing leaks', async () => {
  await withServer([{ status: 401 }], async (url, calls) => {
    const { code, out } = await runSmoke(['--runs', '3'], { FOUNDRY_API_KEY: KEY, FOUNDRY_URL: url });
    assert.strictEqual(code, 1);
    assert.strictEqual(calls(), 1, 'must not repeat a request that cannot succeed');
    assert.match(out, /AuthenticationError HTTP 401/); assert.match(out, /stopped after run 1/); assert.match(out, /Cannot compare/);
    assert.ok(!out.includes(KEY));
  });
});

test('--runs: invalid values are refused before any model call', async () => {
  await withServer([{ variant: 'full' }], async (url, calls) => {
    for (const v of ['0', '11', 'abc', '2.5']) {
       
      const { code, out } = await runSmoke(['--runs', v], { FOUNDRY_API_KEY: KEY, FOUNDRY_URL: url });
      assert.strictEqual(code, 2, v); assert.match(out, /--runs needs a whole number from 1 to 10/);
    }
    assert.strictEqual(calls(), 0);
  });
});

test('--runs 1 (and no --runs) keep the single-run behaviour and output file format', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-runs1-'));
  const file = path.join(dir, 'one.json');
  await withServer([{ variant: 'full' }], async (url, calls) => {
    const { code, out } = await runSmoke(['--runs', '1', '--out', file], { FOUNDRY_API_KEY: KEY, FOUNDRY_URL: url });
    assert.strictEqual(code, 0, out); assert.strictEqual(calls(), 1);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(j.definition && j.manifest && j.autoRepairs && !j.perRun);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});
