// DEV_AUTH_BYPASS: works in local dev, is REFUSED in production, and never replaces the check when it is off.
process.env.FW_LOGGING_METHOD = 'console';
process.env.FW_ENV = 'dev';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const FORM_IMPORT = require.resolve('../helpers/form_import');
const origLoad = Module._load;
let msalCalls = 0;
Module._load = function (request, parent, ...rest) {
  if (/helpers\/msalAuth(\.js)?$|^\.\/msalAuth(\.js)?$/.test(request)) return { requireMsalIdentity: (req, res, next) => { msalCalls += 1; next(); } };
  if (/models\/indexSQL(\.js)?$/.test(request)) throw new Error('SQL layer must not be loaded by the import path');
  return origLoad.call(this, request, parent, ...rest);
};

const loadFresh = (env) => {
  const saved = {};
  Object.keys(env).forEach((k) => { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; });
  delete require.cache[FORM_IMPORT];
  try { return require('../helpers/form_import'); } finally { Object.keys(saved).forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
};
const mkRes = () => { const r = { headers: {}, set(k, v) { r.headers[k] = v; return r; } }; return r; };

test('bypass ON in dev: fixed MIS-admin identity, flagged response header, real token check not called', () => {
  const m = loadFresh({ DEV_AUTH_BYPASS: 'true', NODE_ENV: undefined });
  assert.strictEqual(m.DEV_AUTH_BYPASS, true);
  const req = {}; const res = mkRes(); let nexted = false;
  m.requireMisIdentity(req, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.strictEqual(req.callerIdentity.companyId, 2000);
  assert.ok(req.callerIdentity.employeeId > 0);
  assert.strictEqual(res.headers['X-Dev-Auth-Bypass'], 'true');
  assert.strictEqual(msalCalls, 0);
  // still an MIS-only route: a different company is refused by requireMisAdmin
  const denied = { code: 200, status(c) { denied.code = c; return denied; }, json() { return denied; } };
  m.requireMisAdmin({ callerIdentity: { companyId: 55, employeeId: 1 } }, denied, () => assert.fail('must not pass'));
  assert.strictEqual(denied.code, 403);
});

test('bypass is REFUSED when NODE_ENV=production', () => {
  assert.throws(() => loadFresh({ DEV_AUTH_BYPASS: 'true', NODE_ENV: 'production' }), /DEV_AUTH_BYPASS=true is not allowed/);
});

test('bypass OFF (or any value other than "true"): the real MSAL check is used and no identity is invented', () => {
  for (const v of [undefined, 'false', '1', 'yes']) {
    const m = loadFresh({ DEV_AUTH_BYPASS: v, NODE_ENV: undefined });
    assert.strictEqual(m.DEV_AUTH_BYPASS, false);
    const before = msalCalls; const req = {};
    m.requireMisIdentity(req, mkRes(), () => {});
    assert.strictEqual(msalCalls, before + 1);
    assert.strictEqual(req.callerIdentity, undefined);
  }
});
