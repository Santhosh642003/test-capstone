// smoke-model.js --out: writes the draft, manifest and auto-repairs, and never a secret. A local HTTP server plays Azure OpenAI.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const KEY = 'smoke-out-test-key-0123456789abcdef-not-real';
const ROOT = path.join(__dirname, '..');
const GOLD = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval', 'gold', 'sample-isp-intake.json'), 'utf8'));

// the gold form with two defects the pipeline repairs: a missing input flag and an unsupported type
const flawed = () => {
  const def = JSON.parse(JSON.stringify(GOLD));
  const fields = [];
  (function walk(cs) { cs.forEach((c) => { if (c.input) fields.push({ key: c.key, sourcePage: c.key === 'consentAgree' ? 2 : 1, confidence: c.key === 'dx' ? 0.5 : 0.95, notes: c.key === 'dx' ? 'abbreviated label' : '' }); if (c.components) walk(c.components); }); }(def.components));
  delete def.components[1].components[0].input;
  def.components[1].components[3].type = 'phoneNumber';
  return JSON.stringify({ definition: def, fields });
};

const withServer = async (fn) => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: flawed() } }], usage: { prompt_tokens: 100, completion_tokens: 50 } })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}/openai/v1`); } finally { server.close(); }
};

const runSmoke = (args, env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smoke-model.js'), ...args], { env: { PATH: process.env.PATH, ...env }, cwd: ROOT });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out }));
});

test('--out writes the draft, the per-field manifest and the auto-repairs, with no secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-out-'));
  const file = path.join(dir, 'nested', 'draft.json');
  await withServer(async (url) => {
    const { code, out } = await runSmoke(['--out', file], { FOUNDRY_API_KEY: KEY, FOUNDRY_URL: url, FOUNDRY_LLM_MODEL: 'my-deployment' });
    assert.strictEqual(code, 0, out);
    assert.match(out, /Draft written to/);
    assert.ok(!out.includes(KEY));
    const text = fs.readFileSync(file, 'utf8');
    const j = JSON.parse(text);

    assert.strictEqual(j.deployment, 'my-deployment');
    assert.ok(j.definition.components.length > 3);
    assert.deepStrictEqual(j.validatorErrors, []);
    assert.strictEqual(j.manifest.length, 19);
    const dx = j.manifest.find((f) => f.key === 'dx');
    assert.deepStrictEqual(Object.keys(dx).sort(), ['confidence', 'flags', 'key', 'label', 'notes', 'section', 'sourcePage', 'type']);
    assert.strictEqual(dx.confidence, 0.5); assert.strictEqual(dx.notes, 'abbreviated label');
    assert.ok(dx.flags.includes('Very short label'));
    assert.strictEqual(j.manifest.find((f) => f.key === 'consentAgree').sourcePage, 2);
    const changes = j.autoRepairs.map((r) => r.change);
    assert.ok(changes.includes('type-alias') && changes.includes('set-input'), `repairs: ${changes.join(',')}`);
    assert.deepStrictEqual(j.autoRepairs.find((r) => r.change === 'type-alias'), { change: 'type-alias', key: 'phoneNumber', from: 'phoneNumber', to: 'textfield' });

    // no credentials, endpoint or raw transport details anywhere in the file
    [KEY, 'Authorization', 'Bearer', '127.0.0.1', 'api-key', 'FOUNDRY_URL'].forEach((s) => assert.ok(!text.includes(s), `file contains ${s}`));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without --out nothing is written; --out with no path or an .env path is refused before any model call', async () => {
  await withServer(async (url) => {
    const env = { FOUNDRY_API_KEY: KEY, FOUNDRY_URL: url };
    const plain = await runSmoke([], env);
    assert.strictEqual(plain.code, 0); assert.ok(!/Draft written to/.test(plain.out));
    const noPath = await runSmoke(['--out'], env);
    assert.strictEqual(noPath.code, 2); assert.match(noPath.out, /--out needs a file path/);
    const envFile = await runSmoke(['--out', path.join(os.tmpdir(), '.env')], env);
    assert.strictEqual(envFile.code, 2); assert.match(envFile.out, /refusing/);
  });
});
