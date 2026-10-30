const { DBSendResponse, DBinsertSendResponse, DBUpdate } = require('../queries/commonQueries');
const TABLE = 'referral_setting';
const GUID_COL = 'company_guid'; // assumed GUID column inside referral_setting

async function fetchActive(companyId) {
  const q = `SELECT TOP 1 * FROM ${TABLE} WHERE company_id=${companyId} AND SYSUTCDATETIME() BETWEEN start_at AND end_at ORDER BY start_at DESC;`;
  return await DBSendResponse(q);
}

exports.getActive = async (req, res) => {
  const { company_id } = req.params;
  try {
    const rows = await fetchActive(company_id);
    if (!rows || !rows.length) return res.status(404).json({ message: 'No active referral setting' });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Error fetching active setting' }); }
};

exports.getHistory = async (req, res) => {
  const { company_id } = req.params;
  try {
    const q = `SELECT * FROM ${TABLE} WHERE company_id=${company_id} ORDER BY start_at DESC;`;
    const rows = await DBSendResponse(q);
    res.json(rows || []);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Error fetching history' }); }
};

// Unified upsert: create initial row if none; otherwise update active or create new version based on tracked field changes.
exports.upsertSettings = async (req, res) => {
  const { company_id } = req.params;
  const {
    referral_coordinator_emp_id,
  referral_form_incoming_id,
  referral_form_outgoing_id,
    referral_flow_id,
    company_guid,
    print_include_referrer_info,
  } = req.body || {};

  try {
    const activeRows = await fetchActive(company_id);

    // If no active row, create initial
    if (!activeRows || !activeRows.length) {
      // Determine GUID
      let guid = company_guid;
      if (!guid) {
        try { guid = await generateGuidForCompany(company_id); } catch (gErr) {
          return res.status(404).json({ message: 'Company not found for GUID generation' });
        }
      }
  const insertQ = `INSERT INTO ${TABLE} (company_id, ${GUID_COL}, referral_coordinator_emp_id, referral_form_incoming_id, referral_form_outgoing_id, referral_flow_id)
           OUTPUT Inserted.*
           VALUES (${company_id}, '${guid}', ${referral_coordinator_emp_id ?? 'NULL'}, ${referral_form_incoming_id ?? 'NULL'}, ${referral_form_outgoing_id ?? 'NULL'}, ${referral_flow_id ?? 'NULL'});`;
      const rows = await DBinsertSendResponse(insertQ);
      return res.status(201).json({ message: 'Created', setting: rows && rows[0] ? rows[0] : null });
    }

    const active = activeRows[0];

    // Determine if tracked fields changed (only when provided)
    const coordChanged = referral_coordinator_emp_id !== undefined && referral_coordinator_emp_id != active.referral_coordinator_emp_id;
    const flowChanged = referral_flow_id !== undefined && referral_flow_id != active.referral_flow_id;
    const formIncomingChanged = referral_form_incoming_id !== undefined && referral_form_incoming_id != active.referral_form_incoming_id;
    const formOutgoingChanged = referral_form_outgoing_id !== undefined && referral_form_outgoing_id != active.referral_form_outgoing_id;
    const triggersVersion = coordChanged || formIncomingChanged || formOutgoingChanged || flowChanged;

    if (!triggersVersion) {
      // Update active row in-place for non-versioned fields (e.g., company_guid) or if explicitly re-setting same values
      const updates = [];
      if (company_guid !== undefined && company_guid !== active[GUID_COL]) updates.push(`${GUID_COL}='${company_guid}'`);
  if (referral_coordinator_emp_id !== undefined) updates.push(`referral_coordinator_emp_id=${referral_coordinator_emp_id ?? 'NULL'}`);
  if (referral_form_incoming_id !== undefined) updates.push(`referral_form_incoming_id=${referral_form_incoming_id ?? 'NULL'}`);
  if (referral_form_outgoing_id !== undefined) updates.push(`referral_form_outgoing_id=${referral_form_outgoing_id ?? 'NULL'}`);
      if (referral_flow_id !== undefined) updates.push(`referral_flow_id=${referral_flow_id ?? 'NULL'}`);
      if (print_include_referrer_info !== undefined) updates.push(`print_include_referrer_info=${print_include_referrer_info ? 1 : 0}`);
      if (updates.length === 0) {
        return res.status(200).json({ message: 'No changes', setting: active });
      }
      const updQ = `UPDATE ${TABLE} SET ${updates.join(', ')}, updated_at=SYSUTCDATETIME() WHERE referral_setting_id=${active.referral_setting_id};`;
      await DBUpdate(updQ);
      const refreshed = await fetchActive(company_id);
      return res.status(200).json({ message: 'Updated', setting: refreshed && refreshed[0] ? refreshed[0] : active });
    }

    // Version: close current and insert new with provided values overriding, others carried over
  const closeQ = `UPDATE ${TABLE} SET end_at=SYSUTCDATETIME(), updated_at=SYSUTCDATETIME() WHERE referral_setting_id=${active.referral_setting_id};`;
    await DBUpdate(closeQ);

    const newCoordinator = referral_coordinator_emp_id !== undefined ? (referral_coordinator_emp_id ?? 'NULL') : (active.referral_coordinator_emp_id ?? 'NULL');
  const newFormIncoming = referral_form_incoming_id !== undefined ? (referral_form_incoming_id ?? 'NULL') : (active.referral_form_incoming_id ?? 'NULL');
  const newFormOutgoing = referral_form_outgoing_id !== undefined ? (referral_form_outgoing_id ?? 'NULL') : (active.referral_form_outgoing_id ?? 'NULL');
    const newFlow = referral_flow_id !== undefined ? (referral_flow_id ?? 'NULL') : (active.referral_flow_id ?? 'NULL');
    const newGuid = company_guid !== undefined ? `'${company_guid}'` : (active[GUID_COL] ? `'${active[GUID_COL]}'` : 'NULL');

  const insertVersionQ = `INSERT INTO ${TABLE} (company_id, ${GUID_COL}, referral_coordinator_emp_id, referral_form_incoming_id, referral_form_outgoing_id, referral_flow_id)
               OUTPUT Inserted.*
               VALUES (${company_id}, ${newGuid}, ${newCoordinator}, ${newFormIncoming}, ${newFormOutgoing}, ${newFlow});`;
  const rows = await DBinsertSendResponse(insertVersionQ);
    return res.status(201).json({ message: 'Version created', previous: active, current: rows && rows[0] ? rows[0] : null });
  } catch (e) {
    console.error(e); res.status(500).json({ message: 'Error upserting settings' });
  }
};

// Generate a GUID slug based on company name and ensure uniqueness within referral_setting table.
async function generateGuidForCompany(companyId) {
  const nameRes = await DBSendResponse(`SELECT com_name FROM company WHERE com_id=${companyId}`);
  if (!nameRes || !nameRes.length) throw new Error('Company not found');
  let baseGuid = nameRes[0].com_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!baseGuid) baseGuid = `company-${companyId}`;
  const countRes = await DBSendResponse(`SELECT COUNT(*) as count FROM ${TABLE} WHERE ${GUID_COL} LIKE '${baseGuid}%'`);
  const count = countRes[0].count;
  return count > 0 ? `${baseGuid}${count + 1}` : baseGuid;
}

exports.createInitial = async (req, res) => {
  const { company_id } = req.params;
  const {
    referral_coordinator_emp_id = 'NULL',
    referral_form_incoming_id = 'NULL',
    referral_form_outgoing_id = 'NULL',
    referral_flow_id = 'NULL'
  } = req.body || {};
  try {
    const active = await fetchActive(company_id);
    if (active && active.length) return res.status(409).json({ message: 'Active setting already exists. Use PUT to version changes.' });

  // Generate new GUID stored on referral_setting initial row
  let guid;
  try { guid = await generateGuidForCompany(company_id); } catch (gErr) { return res.status(404).json({ message: 'Company not found for GUID generation' }); }
    const insertQ = `INSERT INTO ${TABLE} (company_id, ${GUID_COL}, referral_coordinator_emp_id, referral_form_incoming_id, referral_form_outgoing_id, referral_flow_id)
                     OUTPUT Inserted.*
                     VALUES (${company_id}, '${guid}', ${referral_coordinator_emp_id}, ${referral_form_incoming_id}, ${referral_form_outgoing_id}, ${referral_flow_id});`;
    const rows = await DBinsertSendResponse(insertQ);
    const created = rows && rows[0] ? rows[0] : null;
    res.status(201).json({
      message: 'Created',
      company_guid: guid,
      setting: created
    });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Error creating initial setting' }); }
};

exports.updateVersioned = async (req, res) => {
  const { company_id } = req.params;
  const { referral_coordinator_emp_id, referral_form_incoming_id, referral_form_outgoing_id, referral_flow_id } = req.body || {};
  try {
    const activeRows = await fetchActive(company_id);
    if (!activeRows || !activeRows.length) return res.status(404).json({ message: 'No active setting. Use POST to create initial.' });
    const active = activeRows[0];
    const changes = {};
    if (referral_coordinator_emp_id !== undefined && referral_coordinator_emp_id != active.referral_coordinator_emp_id) changes.referral_coordinator_emp_id = referral_coordinator_emp_id;
    if (referral_form_incoming_id !== undefined && referral_form_incoming_id != active.referral_form_incoming_id) changes.referral_form_incoming_id = referral_form_incoming_id;
    if (referral_form_outgoing_id !== undefined && referral_form_outgoing_id != active.referral_form_outgoing_id) changes.referral_form_outgoing_id = referral_form_outgoing_id;
    if (referral_flow_id !== undefined && referral_flow_id != active.referral_flow_id) changes.referral_flow_id = referral_flow_id;
    if (!Object.keys(changes).length) return res.status(200).json({ message: 'No versionable field changes', active });
    const closeQ = `UPDATE ${TABLE} SET end_at=SYSUTCDATETIME(), updated_at=SYSUTCDATETIME() WHERE referral_setting_id=${active.referral_setting_id};`;
    await DBUpdate(closeQ);
    const newVals = {
      referral_coordinator_emp_id: changes.referral_coordinator_emp_id !== undefined ? changes.referral_coordinator_emp_id : active.referral_coordinator_emp_id,
      referral_form_incoming_id: changes.referral_form_incoming_id !== undefined ? changes.referral_form_incoming_id : active.referral_form_incoming_id,
      referral_form_outgoing_id: changes.referral_form_outgoing_id !== undefined ? changes.referral_form_outgoing_id : active.referral_form_outgoing_id,
      referral_flow_id: changes.referral_flow_id !== undefined ? changes.referral_flow_id : active.referral_flow_id
    };
    const insertQ = `INSERT INTO ${TABLE} (company_id, referral_coordinator_emp_id, referral_form_incoming_id, referral_form_outgoing_id, referral_flow_id)
                     OUTPUT Inserted.*
                     VALUES (${company_id}, ${newVals.referral_coordinator_emp_id ?? 'NULL'}, ${newVals.referral_form_incoming_id ?? 'NULL'}, ${newVals.referral_form_outgoing_id ?? 'NULL'}, ${newVals.referral_flow_id ?? 'NULL'});`;
    const rows = await DBinsertSendResponse(insertQ);
    // Include current company GUID (may be useful to caller)
  // GUID stays constant across versions unless explicitly changed via GUID endpoints
  const guid = active[GUID_COL];
  res.status(201).json({ message: 'Version created', company_guid: guid, previous: active, current: rows && rows[0] ? rows[0] : null });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Error creating new version' }); }
};

exports.retireSetting = async (req, res) => {
  const { company_id, setting_id } = req.params;
  try {
    const q = `SELECT * FROM ${TABLE} WHERE referral_setting_id=${setting_id} AND company_id=${company_id}`;
    const rows = await DBSendResponse(q);
    if (!rows || !rows.length) return res.status(404).json({ message: 'Setting not found' });
    const setting = rows[0];
  if (new Date(setting.end_at) < new Date()) return res.status(200).json({ message: 'Already inactive', setting });
  const upd = `UPDATE ${TABLE} SET end_at=SYSUTCDATETIME(), updated_at=SYSUTCDATETIME() WHERE referral_setting_id=${setting_id};`;
    await DBUpdate(upd);
    res.json({ message: 'Retired', setting_id });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Error retiring setting' }); }
};

// --- Company GUID logic migrated from company_v2 ---
exports.getCompanyGUID = async function (req, res) {
  const companyId = req.params.company_id;
  try {
    const active = await fetchActive(companyId);
    if (!active || !active.length) return res.status(404).json({ message: 'No active referral setting' });
    return res.status(200).json(active[0][GUID_COL]);
  } catch (err) { console.error(err); return res.status(500).json({ message: 'Error fetching GUID' }); }
};

exports.generateCompanyGUID = async function (req, res) {
  const companyId = req.params.company_id;
  try {
    const active = await fetchActive(companyId);
    if (active && active.length && active[0][GUID_COL]) return res.status(200).json(active[0][GUID_COL]);
    const guid = await generateGuidForCompany(companyId);
    if (active && active.length) {
      // Update existing active row in place (no version change) only if GUID column null
      await DBUpdate(`UPDATE ${TABLE} SET ${GUID_COL}='${guid}', updated_at=SYSUTCDATETIME() WHERE referral_setting_id=${active[0].referral_setting_id}`);
      return res.status(200).json(guid);
    }
    // No active row: create initial setting minimal with GUID
    const insertQ = `INSERT INTO ${TABLE} (company_id, ${GUID_COL}) OUTPUT Inserted.${GUID_COL} VALUES (${companyId}, '${guid}')`;
    const rows = await DBinsertSendResponse(insertQ);
    return res.status(200).json(rows && rows[0] ? rows[0][GUID_COL] : guid);
  } catch (err) { console.error(err); return res.status(500).json({ message: 'Error generating GUID' }); }
};

exports.updateCompanyGUID = async function (req, res) {
  const companyId = req.params.company_id;
  const { company_guid } = req.body; // updated field name
  if (!company_guid) return res.status(400).json({ message: 'company_guid is required' });
  try {
    const active = await fetchActive(companyId);
    if (!active || !active.length) return res.status(404).json({ message: 'No active referral setting' });
    // Create a new version containing the new GUID (GUID change considered a version event)
    const current = active[0];
  const closeQ = `UPDATE ${TABLE} SET end_at=SYSUTCDATETIME(), updated_at=SYSUTCDATETIME() WHERE referral_setting_id=${current.referral_setting_id}`;
    await DBUpdate(closeQ);
    const insertQ = `INSERT INTO ${TABLE} (company_id, ${GUID_COL}, referral_coordinator_emp_id, referral_form_incoming_id, referral_form_outgoing_id, referral_flow_id)
                     OUTPUT Inserted.*
                     VALUES (${companyId}, '${company_guid}', ${current.referral_coordinator_emp_id ?? 'NULL'}, ${current.referral_form_incoming_id ?? 'NULL'}, ${current.referral_form_outgoing_id ?? 'NULL'}, ${current.referral_flow_id ?? 'NULL'});`;
    const rows = await DBinsertSendResponse(insertQ);
    return res.status(200).json(rows && rows[0] ? rows[0][GUID_COL] : company_guid);
  } catch (err) { console.error(err); return res.status(500).json({ message: 'Error updating GUID' }); }
};

exports.verifyCompanyGUID = async function (req, res) {
  const guid = req.params.guid;
  try {
    const query = `select top 1 company_id from ${TABLE} where ${GUID_COL}='${guid}'`;
    const result = await DBSendResponse(query);
    if (!result.length) return res.status(404).json({ exists: false, message: 'GUID not found' });
    return res.status(200).json({ exists: true, company_id: result[0].company_id });
  } catch (err) { console.error(err); return res.status(500).json({ message: 'Error verifying GUID' }); }
};

// Search companies with active referral_setting GUIDs by name or GUID
exports.searchCompanies = async function (req, res) {  
  const q = req.query.q;
  if (!q) return res.status(400).json({ message: 'q is required' });
  try {
    const safe = String(q).replace(/'/g, "''");
    const sql = `
      SELECT c.com_id AS company_id,
             c.com_name AS company_name,
             rs.${GUID_COL} AS company_guid,
             'internal' AS source_type,
             NULL AS external_company_id,
             rs.referral_form_incoming_id
        FROM company c
        JOIN ${TABLE} rs
          ON rs.company_id = c.com_id
         AND SYSUTCDATETIME() BETWEEN rs.start_at AND rs.end_at
       WHERE rs.${GUID_COL} IS NOT NULL
         AND (
              c.com_name LIKE '%${safe}%'
              OR rs.${GUID_COL} LIKE '%${safe}%'
         )
      UNION ALL
      SELECT NULL AS company_id,
             erc.company_name AS company_name,
             NULL AS company_guid,
             'external' AS source_type,
             erc.external_company_id,
             NULL AS referral_form_incoming_id
        FROM external_referral_company erc
       WHERE erc.company_name LIKE '%${safe}%'
      ORDER BY company_name ASC`;
    const rows = await DBSendResponse(sql);
    return res.json(rows || []);
  } catch (err) {
    console.error('Error searching companies via referral_setting', err);
    return res.status(500).json({ message: 'Error searching companies' });
  }
};
