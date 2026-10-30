// check:env logic. Pure function: no network, no files, and it must never copy a value into its result.
process.env.FW_LOGGING_METHOD = 'console';
const test = require('node:test');
const assert = require('node:assert');
const { checkEnv, migrationCommand } = require('../scripts/check-env');

const row = (res, name) => res.rows.find((r) => r.name === name);

test('check:env: empty environment is not ready, and FW_ENV unset warns about the prod default', () => {
  const res = checkEnv({});
  assert.strictEqual(res.smokeReady, false);
  assert.strictEqual(res.apiReady, false);
  assert.strictEqual(row(res, 'FOUNDRY_API_KEY').state, 'missing');
  assert.strictEqual(res.env, 'prod');
  assert.ok(res.warnings.some((w) => /FW_ENV is unset/.test(w)));
});

test('check:env: Azure OpenAI vars alone make the smoke test ready but not the full API', () => {
  const res = checkEnv({ FOUNDRY_API_KEY: 'k'.repeat(32), FOUNDRY_URL: 'https://r.openai.azure.com/openai/v1', FW_ENV: 'dev' });
  assert.strictEqual(res.smokeReady, true);
  assert.strictEqual(res.apiReady, false);
  assert.strictEqual(row(res, 'FOUNDRY_LLM_MODEL').state, 'missing'); // optional: does not block
  assert.strictEqual(row(res, 'APIDB_DEV').needs, 'api');
  assert.deepStrictEqual(res.warnings, []);
});

test('check:env: everything set is ready; the names checked follow FW_ENV', () => {
  const env = {
    FOUNDRY_API_KEY: 'k'.repeat(32), FOUNDRY_URL: 'https://r.openai.azure.com/openai/v1', FW_ENV: 'test',
    DB_SERVER_DEV: 's', DB_USERNAME_DEV: 'u', DB_PWD_DEV: 'p', APIDB_TEST: 'db', BLOB_KEY: 'dGVzdA==', CONTAINER_NAME_TEST: 'c',
  };
  const res = checkEnv(env);
  assert.strictEqual(res.apiReady, true);
  assert.ok(row(res, 'APIDB_TEST') && !row(res, 'APIDB_DEV'));
  const prod = checkEnv({ ...env, FW_ENV: 'prod' });
  assert.ok(row(prod, 'DB_SERVER_PROD') && !row(prod, 'DB_SERVER_DEV'));
});

test('check:env: placeholders count as missing; bad URL shapes and invalid base64 are called out', () => {
  const res = checkEnv({ FOUNDRY_API_KEY: '<azure-openai-key>', FOUNDRY_URL: 'https://r.openai.azure.com/openai/v1/chat/completions', BLOB_KEY: '<base64>', FW_ENV: 'dev' });
  assert.strictEqual(row(res, 'FOUNDRY_API_KEY').state, 'placeholder');
  assert.strictEqual(res.smokeReady, false);
  assert.ok(res.warnings.some((w) => /BASE/.test(w)));
  assert.ok(res.warnings.some((w) => /base64/.test(w)));
});

test('check:env: DEV_AUTH_BYPASS together with prod is flagged', () => {
  assert.ok(checkEnv({ DEV_AUTH_BYPASS: 'true', FW_ENV: 'prod' }).warnings.some((w) => /refuse to start/.test(w)));
  assert.ok(checkEnv({ DEV_AUTH_BYPASS: 'true', FW_ENV: 'dev', NODE_ENV: 'production' }).warnings.some((w) => /refuse to start/.test(w)));
  assert.ok(!checkEnv({ DEV_AUTH_BYPASS: 'true', FW_ENV: 'dev' }).warnings.some((w) => /refuse to start/.test(w)));
});

test('check:env: no secret value ever appears in the report', () => {
  const secrets = ['SECRET-KEY-VALUE-1234567890abcdef', 'sup3rS3cretPwd!', 'dGVzdFN0b3JhZ2VLZXk='];
  const res = checkEnv({ FOUNDRY_API_KEY: secrets[0], FOUNDRY_URL: 'https://r.openai.azure.com/openai/v1', DB_PWD_DEV: secrets[1], BLOB_KEY: secrets[2], FW_ENV: 'dev' });
  const text = JSON.stringify(res);
  secrets.forEach((s) => assert.ok(!text.includes(s), 'secret leaked into the report'));
});

test('check:env: migration command names the target database and never contains the password', () => {
  const m = migrationCommand({ FW_ENV: 'dev', DB_SERVER_DEV: 'srv.example.net', APIDB_DEV: 'FieldworkerDev', DB_PWD_DEV: 'hunter2-hunter2' });
  assert.strictEqual(m.database, 'FieldworkerDev');
  assert.match(m.command, /-d FieldworkerDev/);
  assert.match(m.command, /002_form_packs\.sql/);
  assert.ok(!m.command.includes('hunter2'));
});
