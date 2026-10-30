// HTTP handler tests with the database, blob storage and model stubbed out.
process.env.FW_LOGGING_METHOD = 'console';
process.env.BLOB_KEY = process.env.BLOB_KEY || 'dGVzdA==';
const { Buffer } = require('buffer');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// ---- fake mssql ----
const log = [];
let rowsFor = () => ({ recordset: [], rowsAffected: [1] });
class Request {
  constructor() { this.params = {}; }
  input(name, type, value) { this.params[name] = value; return this; }
  async query(sql) { log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: { ...this.params } }); return rowsFor(sql, this.params); }
}
class Transaction { async begin() { log.push({ tx: 'begin' }); } async commit() { log.push({ tx: 'commit' }); } async rollback() { log.push({ tx: 'rollback' }); } }
const fakeDb = { Request, Transaction, Int: 'Int', VarChar: () => 'VarChar', NVarChar: () => 'NVarChar', MAX: 'MAX' };
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (/models\/indexSQL(\.js)?$/.test(request)) return fakeDb;
  if (/queries\/commonQueries(\.js)?$/.test(request)) return { DBSendResponseParam: async (sql, params) => { log.push({ sql, params }); return rowsFor(sql, params).recordset; } };
  return origLoad.call(this, request, parent, ...rest);
};

const imp = require('../helpers/form_import');
const packs = require('../helpers/form_packs');
const jobs = require('../helpers/formImportJobs');
const subset = require('../helpers/formioSubset');

const SAMPLE_PDF = fs.readFileSync(path.join(__dirname, '..', 'eval', 'pdfs', 'sample-isp-intake.pdf'));
const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'gold', 'sample-isp-intake.json'), 'utf8'));
const mkRes = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const admin = { companyId: 2000, employeeId: 7 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('requireMisAdmin only lets the MIS company through', () => {
  let called = 0; const next = () => { called += 1; };
  imp.requireMisAdmin({ callerIdentity: { companyId: 2000 } }, mkRes(), next);
  const denied = mkRes();
  imp.requireMisAdmin({ callerIdentity: { companyId: 55 } }, denied, next);
  imp.requireMisAdmin({}, mkRes(), next);
  assert.strictEqual(called, 1);
  assert.strictEqual(denied.code, 403);
});

test('import: upload returns a jobId, the job runs in the background, the owner can poll the result', async () => {
  jobs.__reset();
  imp.deps.callModel = async () => ({ content: JSON.stringify({ definition: GOLD, fields: [] }), usage: { prompt_tokens: 10, completion_tokens: 5 } });
  imp.deps.uploadSource = async () => 'https://blob.example/source.pdf';
  const res = mkRes();
  await imp.postImport({ file: { buffer: SAMPLE_PDF, originalname: 'a.pdf' }, callerIdentity: admin }, res);
  assert.strictEqual(res.code, 202);
  const { jobId } = res.body;
  let view;
  for (let i = 0; i < 50; i += 1) { view = jobs.publicView(jobs.getJob(jobId)); if (view.status !== 'running') break; await wait(50); }
  assert.strictEqual(view.status, 'done');
  assert.deepStrictEqual(view.result.problems, []);
  assert.ok(view.result.fields.length > 10);
  assert.strictEqual('blobUrl' in view, false);

  const mine = mkRes(); imp.getImportJob({ params: { jobId }, callerIdentity: admin }, mine);
  assert.strictEqual(mine.body.status, 'done');
  const theirs = mkRes(); imp.getImportJob({ params: { jobId }, callerIdentity: { companyId: 2000, employeeId: 8 } }, theirs);
  assert.strictEqual(theirs.code, 404, 'another employee cannot read the job');
});

test('import: unsupported uploads are refused before any job or model call', async () => {
  jobs.__reset();
  let modelCalls = 0; imp.deps.callModel = async () => { modelCalls += 1; return { content: '{}' }; };
  const res = mkRes();
  await imp.postImport({ file: { buffer: Buffer.from('not a pdf'), originalname: 'x.pdf' }, callerIdentity: admin }, res);
  assert.strictEqual(res.code, 415);
  const none = mkRes(); await imp.postImport({ callerIdentity: admin }, none);
  assert.strictEqual(none.code, 400);
  assert.strictEqual(modelCalls, 0);
});

test('import: a model failure becomes a failed job with a safe message', async () => {
  jobs.__reset();
  imp.deps.callModel = async () => { throw new Error('boom: secret details'); };
  imp.deps.uploadSource = async () => null;
  const res = mkRes();
  await imp.postImport({ file: { buffer: SAMPLE_PDF, originalname: 'a.pdf' }, callerIdentity: admin }, res);
  let view;
  for (let i = 0; i < 50; i += 1) { view = jobs.publicView(jobs.getJob(res.body.jobId)); if (view.status !== 'running') break; await wait(50); }
  assert.strictEqual(view.status, 'failed');
  assert.ok(!/secret/.test(view.error));
});

const publishBody = (over = {}) => ({
  definition: GOLD, usage: { model: 'gpt-4.1', promptVersion: 'ff-0.1.0' }, filename: 'a.pdf',
  details: { name: 'Intake', description: 'Desc', formType: 'Intake', state: 'NJ', agency: 'NJ DDD', companyTypes: [101], ...over },
});

test('publish: one transaction, parameterised SQL, form_state + provenance written', async () => {
  log.length = 0;
  rowsFor = (sql) => (/MAX\(form_id\)/.test(sql) ? { recordset: [{ next_id: 2100 }] } : { recordset: [], rowsAffected: [1] });
  const res = mkRes();
  await imp.postPublish({ body: publishBody(), callerIdentity: admin }, res);
  assert.strictEqual(res.code, 200); assert.strictEqual(res.body.form_id, 2100);
  const ins = log.find((l) => /INSERT INTO fw_forms/.test(l.sql || ''));
  assert.ok(ins && /@name/.test(ins.sql) && !/Intake/.test(ins.sql), 'values are parameters, not concatenated');
  assert.strictEqual(ins.params.state, 'NJ'); assert.strictEqual(ins.params.id, 2100);
  assert.ok(JSON.parse(ins.params.schema).components.length);
  const src = log.find((l) => /INSERT INTO form_source/.test(l.sql || ''));
  assert.strictEqual(src.params.pv, 'ff-0.1.0'); assert.strictEqual(src.params.types, '101');
  assert.strictEqual(log.filter((l) => l.tx).map((l) => l.tx).join(), 'begin,commit');
});

test('publish: rejects missing metadata and invalid definitions without touching the database', async () => {
  log.length = 0;
  const a = mkRes(); await imp.postPublish({ body: publishBody({ agency: '' }), callerIdentity: admin }, a);
  assert.strictEqual(a.code, 400);
  const bad = publishBody(); bad.definition = { components: [{ type: 'radio', key: 'r', label: 'R', values: [] }] };
  const b = mkRes(); await imp.postPublish({ body: bad, callerIdentity: admin }, b);
  assert.strictEqual(b.code, 422); assert.ok(b.body.problems.length);
  assert.strictEqual(log.length, 0);
});

test('publish: state "ALL" is stored as NULL; "replaces" must be an existing community form', async () => {
  log.length = 0;
  rowsFor = (sql) => (/MAX\(form_id\)/.test(sql) ? { recordset: [{ next_id: 5 }] } : /public_form = 1/.test(sql) && /@r/.test(sql) ? { recordset: [] } : { recordset: [], rowsAffected: [1] });
  const res = mkRes();
  await imp.postPublish({ body: publishBody({ state: 'all', replacesFormId: 999 }), callerIdentity: admin }, res);
  assert.strictEqual(res.code, 400);
  assert.ok(log.some((l) => l.tx === 'rollback'));
});

test('packs: body validation (one state or all, at least one form, valid company type)', () => {
  const ok = packs.readPackBody({ pack_name: 'SC · NJ', company_type: 101, state_id: 'nj', items: [3, 1, 3] });
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.value.state, 'NJ'); assert.deepStrictEqual(ok.value.items, [3, 1]);
  assert.strictEqual(packs.readPackBody({ pack_name: 'x', state_id: null, items: [1] }).value.state, null);
  assert.ok(packs.readPackBody({ pack_name: 'x', items: [1] }).errors.some((e) => /state/i.test(e)));
  assert.ok(packs.readPackBody({ pack_name: '', state_id: 'NJ', items: [] }).errors.length === 2);
  assert.ok(packs.readPackBody({ pack_name: 'x', state_id: 'NJ', company_type: 7, items: [1] }).errors.some((e) => /Company type/.test(e)));
});

test('packs: subscribe is scoped to the token company, keeps individual subscriptions, and needs a form admin', async () => {
  log.length = 0;
  rowsFor = (sql) => {
    if (/emp_is_admin/.test(sql)) return { recordset: [{ emp_is_admin: 'true' }] };
    if (/FROM form_pack WHERE/.test(sql)) return { recordset: [{ version: 2 }] };
    if (/FROM subscribed_pack WHERE/.test(sql)) return { recordset: [] };
    return { recordset: [], rowsAffected: [3] };
  };
  const res = mkRes();
  await packs.subscribePack({ body: { pack_id: 1, company_id: 999 }, callerIdentity: { companyId: 42, employeeId: 9 } }, res);
  assert.strictEqual(res.body.forms_added, 3);
  const ins = log.find((l) => /INSERT INTO subscribed_form/.test(l.sql || ''));
  assert.strictEqual(ins.params.c, 42, 'company comes from the token, not the body');
  assert.match(ins.sql, /NOT EXISTS/);

  rowsFor = (sql) => (/emp_is_admin/.test(sql) ? { recordset: [{ emp_is_admin: 'false' }] } : { recordset: [] });
  const denied = mkRes();
  await packs.subscribePack({ body: { pack_id: 1 }, callerIdentity: { companyId: 42, employeeId: 9 } }, denied);
  assert.strictEqual(denied.code, 403);
});

test('packs: unsubscribe only deletes rows tagged with that pack', async () => {
  log.length = 0;
  rowsFor = (sql) => (/emp_is_admin/.test(sql) ? { recordset: [{ emp_is_admin: '1' }] } : { recordset: [], rowsAffected: [2] });
  const res = mkRes();
  await packs.unsubscribePack({ body: { pack_id: 1 }, query: {}, callerIdentity: { companyId: 42, employeeId: 9 } }, res);
  const del = log.find((l) => /DELETE FROM subscribed_form/.test(l.sql || ''));
  assert.match(del.sql, /pack_id = @p AND company_id = @c/);
  assert.strictEqual(res.body.forms_removed, 2);
});

test('packs: publishing v2 requires change notes, bumps the version and syncs subscribers in one transaction', async () => {
  log.length = 0;
  rowsFor = (sql) => {
    if (/SELECT \* FROM form_pack/.test(sql)) return { recordset: [{ pack_id: 1, status: 'published', version: 2 }] };
    if (/FROM form_pack_item WHERE pack_id = @id ORDER BY/.test(sql)) return { recordset: [{ form_id: 2004 }, { form_id: 2001 }] };
    return { recordset: [], rowsAffected: [4] };
  };
  const noNotes = mkRes();
  await packs.publishPack({ params: { id: '1' }, body: {}, callerIdentity: admin }, noNotes);
  assert.strictEqual(noNotes.code, 400);
  log.length = 0;
  const res = mkRes();
  await packs.publishPack({ params: { id: '1' }, body: { notes: 'Added incident report' }, callerIdentity: admin }, res);
  assert.strictEqual(res.body.version, 3); assert.strictEqual(res.body.synced, 4);
  assert.ok(log.some((l) => /INSERT INTO form_pack_version/.test(l.sql || '')));
  assert.ok(log.some((l) => /DELETE FROM subscribed_form WHERE pack_id = @p AND form_id NOT IN/.test(l.sql || '')));
  assert.strictEqual(log.filter((l) => l.tx).map((l) => l.tx).join(), 'begin,commit');
});

test('subset.validate still accepts the gold form after all stubs', () => assert.deepStrictEqual(subset.validate(GOLD), []));
