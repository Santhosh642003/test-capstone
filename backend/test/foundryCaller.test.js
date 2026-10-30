// The Azure OpenAI caller: JSON-mode fallback, error classification, and key hygiene. fetch is stubbed; nothing leaves the machine.
process.env.FW_LOGGING_METHOD = 'console';
const test = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('buffer');
const fi = require('../helpers/formIngestion');

const KEY = 'unit-test-key-0123456789abcdef-not-real';
const BASE = 'https://example.openai.azure.com/openai/v1/'; // trailing slash on purpose
const PDF = Buffer.from('%PDF-1.4 stub');
const ENVELOPE = JSON.stringify({ definition: { components: [{ type: 'textfield', key: 'a', label: 'Name', input: true }] }, fields: [] });
const okBody = { choices: [{ message: { content: ENVELOPE } }], usage: { prompt_tokens: 11, completion_tokens: 7 } };

const reply = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const withFetch = async (script, fn) => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const next = script[Math.min(calls.length - 1, script.length - 1)]; if (next instanceof Error) throw next; return next; };
  try { return await fn(calls); } finally { global.fetch = original; }
};
const call = (extra = {}) => fi.makeFoundryCaller({ apiKey: KEY, baseUrl: BASE, model: 'my-deployment', ...extra })({ system: 'sys', text: 'user text', pdf: PDF, filename: 'f.pdf', label: 'unit' });

test('JSON mode accepted together with the PDF part: request shape and mode "json"', async () => {
  await withFetch([reply(200, okBody)], async (calls) => {
    const out = await call();
    assert.strictEqual(out.mode, 'json'); assert.strictEqual(out.fallback, null);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://example.openai.azure.com/openai/v1/chat/completions');
    assert.strictEqual(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    const b = calls[0].body;
    assert.deepStrictEqual(b.response_format, { type: 'json_object' });
    assert.strictEqual(b.temperature, 0); assert.strictEqual(b.model, 'my-deployment');
    const parts = b.messages[1].content;
    assert.strictEqual(parts[1].type, 'file');
    assert.match(parts[1].file.file_data, /^data:application\/pdf;base64,/);
    assert.deepStrictEqual(out.usage, { prompt_tokens: 11, completion_tokens: 7 });
  });
});

test('JSON mode rejected (HTTP 400 about response_format): retried once WITHOUT it, mode "text", fallback recorded', async () => {
  const rejection = { error: { message: 'response_format \'json_object\' is not supported with file inputs' } };
  await withFetch([reply(400, rejection), reply(200, okBody)], async (calls) => {
    const out = await call();
    assert.strictEqual(calls.length, 2);
    assert.ok(calls[0].body.response_format);
    assert.ok(!('response_format' in calls[1].body), 'retry must not send response_format');
    assert.strictEqual(out.mode, 'text');
    assert.strictEqual(out.fallback.status, 400);
    assert.strictEqual(out.fallback.errorClass, 'BadRequest');
    assert.match(out.fallback.message, /response_format/);
  });
});

test('an unrelated HTTP 400 is NOT treated as a JSON-mode rejection', async () => {
  await withFetch([reply(400, { error: { message: 'Invalid file data' } })], async (calls) => {
    await assert.rejects(call(), (e) => e.status === 400 && /Invalid file data/.test(e.message));
    assert.strictEqual(calls.length, 1);
  });
});

test('text-only requested: no response_format is sent and mode is "text" without a fallback record', async () => {
  await withFetch([reply(200, okBody)], async (calls) => {
    const out = await call({ jsonMode: false });
    assert.ok(!('response_format' in calls[0].body));
    assert.strictEqual(out.mode, 'text'); assert.strictEqual(out.fallback, null);
  });
});

test('if the text retry also fails, the error surfaces with its status', async () => {
  await withFetch([reply(400, 'response_format unsupported'), reply(404, { error: { message: 'DeploymentNotFound' } })], async () => {
    await assert.rejects(call(), (e) => e.status === 404);
  });
});

test('401/403/404: clear class + hint, and the API key never appears in the message even if the service echoes it', async () => {
  const cases = [[401, 'AuthenticationError', /FOUNDRY_API_KEY/], [403, 'PermissionDenied', /firewall|allowed networks/i], [404, 'NotFound', /DEPLOYMENT name/]];
  for (const [status, cls, hintRe] of cases) {
     
    await withFetch([reply(status, { error: { message: `bad credentials ${KEY} Bearer ${KEY}` } })], async () => {
      let err;
      try { await call(); } catch (e) { err = e; }
      assert.ok(err, `HTTP ${status} should throw`);
      assert.strictEqual(err.status, status);
      assert.ok(!err.message.includes(KEY), 'key leaked into the error message');
      const info = fi.describeFoundryError(err);
      assert.strictEqual(info.errorClass, cls); assert.strictEqual(info.status, status);
      assert.match(info.hint, hintRe);
      assert.ok(!JSON.stringify(info).includes(KEY));
    });
  }
});

test('429 becomes a rate-limit error with a plain hint', async () => {
  await withFetch([reply(429, { error: { message: 'slow down' } }, { 'retry-after': '1' })], async () => {
    let err;
    try { await call(); } catch (e) { err = e; }
    assert.ok(err); assert.strictEqual(err.name, 'FoundryRateLimitError');
    const info = fi.describeFoundryError(err);
    assert.strictEqual(info.errorClass, 'RateLimit'); assert.match(info.hint, /tokens-per-minute|quota/i);
  });
});

test('network failures and a missing key are classified', async () => {
  const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  assert.strictEqual(fi.describeFoundryError(dns).errorClass, 'NetworkError');
  await assert.rejects(fi.makeFoundryCaller({ apiKey: '' })({ system: 's', text: 't' }), (e) => fi.describeFoundryError(e).errorClass === 'NotConfigured');
});

test('runIngestion records which mode worked in usage.jsonMode', async () => {
  const fs = require('fs');
  const path = require('path');

  const pdf = fs.readFileSync(path.join(__dirname, '..', 'eval', 'pdfs', 'sample-isp-intake.pdf'));
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'gold', 'sample-isp-intake.json'), 'utf8'));
  const callModel = async () => ({ content: JSON.stringify({ definition: gold, fields: [] }), usage: { prompt_tokens: 1, completion_tokens: 1 }, mode: 'text' });
  const r = await fi.runIngestion(pdf, { callModel });
  assert.strictEqual(r.usage.jsonMode, 'text');
});
