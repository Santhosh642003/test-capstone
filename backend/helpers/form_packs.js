// Form packs: curation (MIS administrators) and subscription (FieldWorker company admins).
// subscribed_form stays the single source of truth for a company's forms. Subscribing materialises rows
// into it tagged with pack_id, so every existing query keeps working. Parameterised SQL only.
const db = require('../models/indexSQL.js');
const { DBSendResponseParam } = require('../queries/commonQueries');
const { defaultLogger: logger } = require('../logger');

const PACK_STATUSES = ['draft', 'published', 'retired'];
const asInt = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const sendError = (res, err, message) => { logger.error(err, message); return res.status(500).json({ message }); };

// ---------- Curation (requireMsalIdentity + requireMisAdmin) ----------

const loadPacks = async (where = '', params = {}) => {
  const packs = await DBSendResponseParam(`SELECT p.* FROM form_pack p ${where} ORDER BY p.pack_name`, params);
  if (!packs.length) return [];
  const items = await DBSendResponseParam('SELECT pack_id, form_id, sort_order FROM form_pack_item ORDER BY pack_id, sort_order');
  const versions = await DBSendResponseParam('SELECT pack_id, version, notes, published_on FROM form_pack_version ORDER BY pack_id, version');
  return packs.map((p) => ({
    ...p,
    items: items.filter((i) => i.pack_id === p.pack_id).map((i) => i.form_id),
    history: versions.filter((v) => v.pack_id === p.pack_id).map((v) => ({ version: v.version, on: v.published_on, notes: v.notes })),
  }));
};

// GET /task_form/packs/admin
exports.listPacksAdmin = async (req, res) => {
  try { res.json(await loadPacks()); } catch (err) { sendError(res, err, 'Could not load packs.'); }
};

// GET /task_form/packs/admin/forms  -- community forms, without the (large) json_schema
exports.listCommunityForms = async (req, res) => {
  try {
    res.json(await DBSendResponseParam(
      'SELECT form_id, form_name, form_type, form_state, form_sponsor, public_form, replaces_form_id FROM fw_forms WHERE public_form = 1 AND ISNULL(form_status, 0) <> 2 ORDER BY form_name',
    ));
  } catch (err) { sendError(res, err, 'Could not load community forms.'); }
};

// Validates the body of POST/PUT. Returns { errors, value }.
const readPackBody = (body) => {
  const errors = [];
  const name = typeof body.pack_name === 'string' ? body.pack_name.trim().slice(0, 255) : '';
  if (!name) errors.push('Pack name is required.');
  const companyType = asInt(body.company_type);
  if (companyType !== null && !(companyType >= 101 && companyType <= 106)) errors.push('Company type must be 101-106 or empty.');
  // state_id: a 2-letter code, or null for all states. undefined/'' means the caller did not choose.
  let state;
  if (body.state_id === null) state = null;
  else if (typeof body.state_id === 'string' && /^[A-Za-z]{2}$/.test(body.state_id)) state = body.state_id.toUpperCase();
  else errors.push('Choose exactly one state, or "All states".');
  const items = Array.isArray(body.items) ? [...new Set(body.items.map(Number).filter(Number.isInteger))] : [];
  if (!items.length) errors.push('A pack must contain at least one form.');
  return {
    errors,
    value: { name, description: typeof body.pack_description === 'string' ? body.pack_description.slice(0, 1000) : null, companyType, state, items },
  };
};

const writeItems = async (transaction, packId, items) => {
  // Only community forms can be in a pack.
  const found = await new db.Request(transaction).query(`SELECT form_id FROM fw_forms WHERE public_form = 1 AND form_id IN (${items.map((i) => Number(i)).join(',')})`);
  if (found.recordset.length !== items.length) { const e = new Error('Some forms are not community forms.'); e.code = 'BAD_ITEMS'; throw e; }
  await new db.Request(transaction).input('p', db.Int, packId).query('DELETE FROM form_pack_item WHERE pack_id = @p');
  for (let i = 0; i < items.length; i += 1) {
     
    await new db.Request(transaction).input('p', db.Int, packId).input('f', db.Int, items[i]).input('o', db.Int, i + 1)
      .query('INSERT INTO form_pack_item (pack_id, form_id, sort_order) VALUES (@p, @f, @o)');
  }
};

const saveCommon = async (req, res, packId) => {
  const { errors, value } = readPackBody(req.body || {});
  if (errors.length) return res.status(400).json({ message: errors.join(' '), errors });
  const transaction = new db.Transaction();
  try {
    await transaction.begin();
    let id = packId;
    if (packId === null) {
      const r = await new db.Request(transaction)
        .input('n', db.VarChar(255), value.name).input('d', db.VarChar(1000), value.description)
        .input('t', db.Int, value.companyType).input('s', db.VarChar(2), value.state).input('by', db.Int, req.callerIdentity.employeeId)
        .query('INSERT INTO form_pack (pack_name, pack_description, company_type, state_id, version, status, created_by, created_on) OUTPUT INSERTED.pack_id VALUES (@n, @d, @t, @s, 1, \'draft\', @by, SYSDATETIME())');
      id = r.recordset[0].pack_id;
    } else {
      const r = await new db.Request(transaction)
        .input('id', db.Int, packId).input('n', db.VarChar(255), value.name).input('d', db.VarChar(1000), value.description)
        .input('t', db.Int, value.companyType).input('s', db.VarChar(2), value.state)
        .query('UPDATE form_pack SET pack_name = @n, pack_description = @d, company_type = @t, state_id = @s WHERE pack_id = @id AND status <> \'retired\'');
      if (!r.rowsAffected[0]) { await transaction.rollback(); return res.status(404).json({ message: 'Pack not found or retired.' }); }
    }
    await writeItems(transaction, id, value.items);
    await transaction.commit();
    return res.json({ pack_id: id });
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
    if (err.code === 'BAD_ITEMS') return res.status(400).json({ message: err.message });
    return sendError(res, err, 'Could not save the pack.');
  }
};

// POST /task_form/packs/admin       PUT /task_form/packs/admin/:id
exports.createPack = (req, res) => saveCommon(req, res, null);
exports.updatePack = (req, res) => {
  const id = asInt(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid pack id.' });
  return saveCommon(req, res, id);
};

/**
 * Applies a pack's current form list to every subscribed company (POST /task_form/packs/sync, also run on publish):
 * removes pack-tagged rows for forms that left the pack, adds rows for new forms (never touching a form the
 * company holds individually), and moves subscribed_version up. Runs inside the caller's transaction.
 */
const syncPackTx = async (transaction, packId, employeeId) => {
  const run = (sql) => new db.Request(transaction).input('p', db.Int, packId).input('by', db.Int, employeeId).query(sql);
  await run('DELETE FROM subscribed_form WHERE pack_id = @p AND form_id NOT IN (SELECT form_id FROM form_pack_item WHERE pack_id = @p)');
  const added = await run(`INSERT INTO subscribed_form (company_id, form_id, created_on, created_by, pack_id)
    SELECT sp.company_id, i.form_id, CURRENT_TIMESTAMP, @by, @p
    FROM form_pack_item i JOIN subscribed_pack sp ON sp.pack_id = i.pack_id
    WHERE i.pack_id = @p
      AND NOT EXISTS (SELECT 1 FROM subscribed_form s WHERE s.company_id = sp.company_id AND s.form_id = i.form_id)`);
  const upd = await run('UPDATE subscribed_pack SET subscribed_version = (SELECT version FROM form_pack WHERE pack_id = @p) WHERE pack_id = @p');
  return { subscribers: upd.rowsAffected[0], formsAdded: added.rowsAffected[0] };
};

// POST /task_form/packs/admin/:id/publish   Body: { notes }
// First publish makes the pack visible (v1). Publishing again bumps the version, records what changed, and syncs subscribers.
exports.publishPack = async (req, res) => {
  const id = asInt(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid pack id.' });
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 1000) : '';
  const transaction = new db.Transaction();
  try {
    await transaction.begin();
    const packRes = await new db.Request(transaction).input('id', db.Int, id).query('SELECT * FROM form_pack WITH (UPDLOCK) WHERE pack_id = @id');
    const pack = packRes.recordset[0];
    if (!pack || pack.status === 'retired') { await transaction.rollback(); return res.status(404).json({ message: 'Pack not found or retired.' }); }
    const items = (await new db.Request(transaction).input('id', db.Int, id).query('SELECT form_id FROM form_pack_item WHERE pack_id = @id ORDER BY sort_order')).recordset.map((r) => r.form_id);
    if (!items.length) { await transaction.rollback(); return res.status(400).json({ message: 'A pack must contain at least one form.' }); }
    const first = pack.status !== 'published';
    if (!first && !notes) { await transaction.rollback(); return res.status(400).json({ message: 'Describe what changed in this version.' }); }
    const version = first ? pack.version : pack.version + 1;

    await new db.Request(transaction).input('id', db.Int, id).input('v', db.Int, version)
      .query('UPDATE form_pack SET version = @v, status = \'published\', published_on = SYSDATETIME() WHERE pack_id = @id');
    await new db.Request(transaction).input('id', db.Int, id).input('v', db.Int, version)
      .input('n', db.VarChar(1000), notes || 'Initial pack').input('f', db.VarChar(2000), items.join(',')).input('by', db.Int, req.callerIdentity.employeeId)
      .query('INSERT INTO form_pack_version (pack_id, version, notes, form_ids, published_by, published_on) VALUES (@id, @v, @n, @f, @by, SYSDATETIME())');
    const sync = await syncPackTx(transaction, id, req.callerIdentity.employeeId);
    await transaction.commit();
    return res.json({ pack_id: id, version, synced: sync.subscribers });
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
    return sendError(res, err, 'Could not publish the pack.');
  }
};

// POST /task_form/packs/admin/:id/retire  -- hides the pack; subscribers keep the forms they already have.
exports.retirePack = async (req, res) => {
  const id = asInt(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid pack id.' });
  try {
    const r = await new db.Request().input('id', db.Int, id).query('UPDATE form_pack SET status = \'retired\' WHERE pack_id = @id AND status = \'published\'');
    if (!r.rowsAffected[0]) return res.status(404).json({ message: 'Published pack not found.' });
    return res.json({ pack_id: id, status: 'retired' });
  } catch (err) { return sendError(res, err, 'Could not retire the pack.'); }
};

// POST /task_form/packs/sync   Body: { pack_id }  (MIS administrators; also run automatically on publish)
exports.syncPack = async (req, res) => {
  const id = asInt(req.body?.pack_id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'pack_id is required.' });
  const transaction = new db.Transaction();
  try {
    await transaction.begin();
    const pack = (await new db.Request(transaction).input('id', db.Int, id).query('SELECT status FROM form_pack WHERE pack_id = @id')).recordset[0];
    if (!pack || pack.status !== 'published') { await transaction.rollback(); return res.status(404).json({ message: 'Published pack not found.' }); }
    const sync = await syncPackTx(transaction, id, req.callerIdentity.employeeId);
    await transaction.commit();
    return res.json(sync);
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
    return sendError(res, err, 'Could not sync the pack.');
  }
};

// ---------- Customer side (requireMsalIdentity; company comes from the verified token, never the request) ----------

// company type = feature_id (101-106) of the 'primaryBusinessType' setting; state = feature_id 99 rows.
const companyProfile = async (companyId) => {
  const types = await DBSendResponseParam('SELECT feature_id FROM settings WHERE company_id = @c AND feature_value = \'primaryBusinessType\' AND feature_id BETWEEN 101 AND 106', { c: companyId });
  const states = await DBSendResponseParam('SELECT state_id FROM settings WHERE company_id = @c AND feature_id = 99', { c: companyId });
  return { type: types[0] ? types[0].feature_id : null, states: states.map((s) => s.state_id).filter(Boolean) };
};

const canManageForms = async (employeeId) => {
  const rows = await DBSendResponseParam('SELECT emp_is_admin FROM employee WHERE emp_id = @e', { e: employeeId });
  return !!rows[0] && ['true', '1'].includes(String(rows[0].emp_is_admin).toLowerCase());
};

// GET /task_form/packs  -- published packs, matching company type + state first, with subscription status
exports.getCompanyPacks = async (req, res) => {
  try {
    const { companyId } = req.callerIdentity;
    const profile = await companyProfile(companyId);
    const packs = await loadPacks('WHERE p.status = \'published\'');
    const subs = await DBSendResponseParam('SELECT pack_id, subscribed_version FROM subscribed_pack WHERE company_id = @c', { c: companyId });
    const out = packs.map((p) => ({
      pack_id: p.pack_id, pack_name: p.pack_name, pack_description: p.pack_description,
      company_type: p.company_type, state_id: p.state_id, version: p.version, form_count: p.items.length,
      matching: (p.company_type === null || p.company_type === profile.type) && (p.state_id === null || profile.states.includes(p.state_id)),
      subscribed: subs.some((s) => s.pack_id === p.pack_id),
      subscribed_version: (subs.find((s) => s.pack_id === p.pack_id) || {}).subscribed_version || null,
    })).sort((a, b) => Number(b.matching) - Number(a.matching) || a.pack_name.localeCompare(b.pack_name));
    res.json({ company: { type: profile.type, states: profile.states }, packs: out });
  } catch (err) { sendError(res, err, 'Could not load packs.'); }
};

// POST /task_form/packs/subscribed   Body: { pack_id }
exports.subscribePack = async (req, res) => {
  const packId = asInt(req.body?.pack_id);
  if (!Number.isInteger(packId)) return res.status(400).json({ message: 'pack_id is required.' });
  const { companyId, employeeId } = req.callerIdentity;
  if (!(await canManageForms(employeeId))) return res.status(403).json({ message: 'Only form administrators can subscribe to packs.' });
  const transaction = new db.Transaction();
  try {
    await transaction.begin();
    const pack = (await new db.Request(transaction).input('p', db.Int, packId).query('SELECT version FROM form_pack WHERE pack_id = @p AND status = \'published\'')).recordset[0];
    if (!pack) { await transaction.rollback(); return res.status(404).json({ message: 'Pack not found.' }); }
    const dup = await new db.Request(transaction).input('p', db.Int, packId).input('c', db.Int, companyId).query('SELECT 1 AS x FROM subscribed_pack WHERE pack_id = @p AND company_id = @c');
    if (dup.recordset.length) { await transaction.rollback(); return res.json({ message: 'Already subscribed.' }); }
    await new db.Request(transaction).input('p', db.Int, packId).input('c', db.Int, companyId).input('by', db.Int, employeeId).input('v', db.Int, pack.version)
      .query('INSERT INTO subscribed_pack (pack_id, company_id, subscribed_version, created_on, created_by) VALUES (@p, @c, @v, SYSDATETIME(), @by)');
    // Forms the company already holds individually are left as they are (pack_id stays NULL).
    const added = await new db.Request(transaction).input('p', db.Int, packId).input('c', db.Int, companyId).input('by', db.Int, employeeId)
      .query(`INSERT INTO subscribed_form (company_id, form_id, created_on, created_by, pack_id)
              SELECT @c, i.form_id, CURRENT_TIMESTAMP, @by, @p FROM form_pack_item i
              WHERE i.pack_id = @p AND NOT EXISTS (SELECT 1 FROM subscribed_form s WHERE s.company_id = @c AND s.form_id = i.form_id)`);
    await transaction.commit();
    res.json({ message: 'Subscribed.', forms_added: added.rowsAffected[0] });
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
    sendError(res, err, 'Could not subscribe to the pack.');
  }
};

// DELETE /task_form/packs/subscribed   Body or query: { pack_id }
exports.unsubscribePack = async (req, res) => {
  const packId = asInt((req.body && req.body.pack_id) ?? req.query.pack_id);
  if (!Number.isInteger(packId)) return res.status(400).json({ message: 'pack_id is required.' });
  const { companyId, employeeId } = req.callerIdentity;
  if (!(await canManageForms(employeeId))) return res.status(403).json({ message: 'Only form administrators can unsubscribe from packs.' });
  const transaction = new db.Transaction();
  try {
    await transaction.begin();
    // Only rows this pack added; forms the company subscribed to individually keep pack_id NULL and stay.
    const del = await new db.Request(transaction).input('p', db.Int, packId).input('c', db.Int, companyId)
      .query('DELETE FROM subscribed_form WHERE pack_id = @p AND company_id = @c');
    await new db.Request(transaction).input('p', db.Int, packId).input('c', db.Int, companyId)
      .query('DELETE FROM subscribed_pack WHERE pack_id = @p AND company_id = @c');
    await transaction.commit();
    res.json({ message: 'Unsubscribed.', forms_removed: del.rowsAffected[0] });
  } catch (err) {
    try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
    sendError(res, err, 'Could not unsubscribe from the pack.');
  }
};

exports.PACK_STATUSES = PACK_STATUSES;
exports.readPackBody = readPackBody;
