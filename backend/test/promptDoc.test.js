// prompts/05-form-ingestion.md must be exactly what the code sends. Loads ONLY the pure prompts module and the generator
// logic: no logger, no Azure client, no env vars, no .env. (Run `node scripts/gen-prompt-doc.js` after any prompt edit.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const prompts = require('../helpers/formIngestionPrompts');

const DOC = path.join(__dirname, '..', 'prompts', '05-form-ingestion.md');

test('prompt doc contains every prompt verbatim', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  [prompts.SYSTEM_PROMPT, prompts.CONTRACT_PROMPT, prompts.REPAIR_PROMPT, prompts.PROMPT_VERSION].forEach((t) => assert.ok(doc.includes(t), 'prompt doc is stale: run node scripts/gen-prompt-doc.js'));
});

test('the generator reproduces the committed doc byte for byte, with an empty environment', () => {
  const before = fs.readFileSync(DOC, 'utf8');
  try {
    // A bare environment (no BLOB_KEY, no FW_*, no credentials) is the point: the generator must not need any.
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'gen-prompt-doc.js')], { env: { PATH: process.env.PATH }, stdio: 'pipe', timeout: 30000 });
    assert.strictEqual(fs.readFileSync(DOC, 'utf8'), before, 'generated doc differs from the committed doc: commit the regenerated prompts/05-form-ingestion.md');
  } finally {
    fs.writeFileSync(DOC, before); // never leave the working tree changed by a test run
  }
});

test('the prompts module has no dependencies and reads no environment', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'formIngestionPrompts.js'), 'utf8');
  assert.ok(!/require\(/.test(src), 'formIngestionPrompts.js must stay free of require()');
  assert.ok(!/process\.env/.test(src), 'formIngestionPrompts.js must not read process.env');
});
