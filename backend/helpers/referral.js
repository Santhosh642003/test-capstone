const { DBinsertSendID, DBUpdate, DBSendResponse, generateUpdateSQL } = require('../queries/commonQueries');
const moment = require('moment');
const { CUSTOMERIO_API_KEY, IN_APP_MESSAGE_REFERRAL_ID } = require('../config');
const { APIClient, RegionUS, SendEmailRequest } = require("customerio-node");
const api = new APIClient(CUSTOMERIO_API_KEY, { region: RegionUS });

exports.getAllReferrals = async function (req, res) {
  try {
    const comp_id = parseInt(req.query.comp_id || req.query.company_id);
    const hasStatusFilter = typeof req.query.status === 'string' && req.query.status.trim().length > 0;
    const safeStatus = hasStatusFilter ? req.query.status.trim().replace(/'/g, "''") : null;

    // We need all referrals where the company participates either as initiator or receiver.
    // Duplicate rows could appear if a company somehow appears twice (shouldn't) so we use DISTINCT.
    // Provide a computed column company_role telling how the given comp_id is related.

    if (!comp_id) {
      return res.status(400).json({ message: 'comp_id (company_id) required' });
    }

    const sql = `
      SELECT DISTINCT r.*,
        pi.com_id AS initiator_com_id,
        pi.external_com_id AS initiator_external_com_id,
        ci.com_name AS initiator_com_name,
        eci.company_name AS initiator_external_com_name,
        COALESCE(ci.com_name, eci.company_name, CAST(pi.com_id AS NVARCHAR(50)), CAST(pi.external_com_id AS NVARCHAR(50))) AS initiator_name,
        pr.com_id AS receiver_com_id,
        pr.external_com_id AS receiver_external_com_id,
        cr.com_name AS receiver_com_name,
        ecr.company_name AS receiver_external_com_name,
        COALESCE(cr.com_name, ecr.company_name, CAST(pr.com_id AS NVARCHAR(50)), CAST(pr.external_com_id AS NVARCHAR(50))) AS receiver_name,
             CASE 
               WHEN pi.com_id = ${comp_id} THEN 'initiated'
               WHEN pr.com_id = ${comp_id} THEN 'receiving'
               ELSE NULL
             END AS company_role
      FROM referral r
      LEFT JOIN referral_party pi ON pi.referral_id = r.referral_id AND pi.role = 'initiator'
      LEFT JOIN company ci ON ci.com_id = pi.com_id
      LEFT JOIN external_referral_company eci ON eci.external_company_id = pi.external_com_id
      LEFT JOIN referral_party pr ON pr.referral_id = r.referral_id AND pr.role = 'receiver'
      LEFT JOIN company cr ON cr.com_id = pr.com_id
      LEFT JOIN external_referral_company ecr ON ecr.external_company_id = pr.external_com_id
      WHERE (pi.com_id = ${comp_id} OR pr.com_id = ${comp_id})
        ${safeStatus ? `AND UPPER(r.referral_status) = UPPER('${safeStatus}')` : ''}
    `;
    const referrals = await DBSendResponse(sql);

    console.log(sql);
    
    res.json(referrals);
  } catch (err) {
    console.error('Error fetching referrals:', err);
    res.status(500).json({ message: 'Error fetching referrals' });
  }
};

exports.getReferralPartners = async function (req, res) {
  try {
    const sql = `
            SELECT external_company_id,
              company_name,
              company_address,
              company_phone,
              referral_contact_name AS contact_name,
              referral_contact_email AS contact_email
        FROM external_referral_company
       ORDER BY company_name ASC`;
    const partners = await DBSendResponse(sql);

    console.log(sql, );
    
    res.json(partners || []);
  } catch (err) {
    console.error('Error fetching referral partners:', err);
    res.status(500).json({ message: 'Error fetching referral partners' });
  }
};

exports.getReferralById = async function (req, res) {
  try {
    const id = parseInt(req.params.id);
    const rows = await DBSendResponse(`
      SELECT r.*,
        pi.com_id AS initiator_com_id,
        pi.external_com_id AS initiator_external_com_id,
        pr.com_id AS receiver_com_id,
        pr.external_com_id AS receiver_external_com_id
      FROM referral r
      LEFT JOIN referral_party pi ON pi.referral_id = r.referral_id AND pi.role = 'initiator'
      LEFT JOIN referral_party pr ON pr.referral_id = r.referral_id AND pr.role = 'receiver'
      WHERE r.referral_id = ${id}
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching referral by ID:', err);
    res.status(500).json({ message: 'Error fetching referral' });
  }
};

exports.addReferral = async function (req, res) {
  console.log('[AddReferral] Request body:', req.body);
  
  try {
    const initCom = Number(req.body.initiating_company) || null;
    const recvCom = Number(req.body.receiving_company) || null;
  // Support new naming external_com_id while keeping legacy external_name for backward compatibility
  const initExtRaw = req.body.initiating_external_com_id ?? req.body.initiating_external_name;
  const recvExtRaw = req.body.receiving_external_com_id ?? req.body.receiving_external_name;
  const initExt = initExtRaw ? String(initExtRaw).replace(/'/g, "''") : null;
  const recvExt = recvExtRaw ? String(recvExtRaw).replace(/'/g, "''") : null;

    // Enforce party source constraints: exactly one per party
    if ((!initCom && !initExt) || (initCom && initExt)) {
      return res.status(400).json({ message: 'Provide either initiating_company or initiating_external_com_id (one required, not both). Legacy initiating_external_name still accepted.' });
    }
    if ((!recvCom && !recvExt) || (recvCom && recvExt)) {
      return res.status(400).json({ message: 'Provide either receiving_company or receiving_external_com_id (one required, not both). Legacy receiving_external_name still accepted.' });
    }

    // referral_party.external_com_id is an FK into external_referral_company; resolve a name to
    // an existing row's id, or create a new external_referral_company entry if none matches.
    const resolveExternalCompanyId = async (raw) => {
      if (raw === null || raw === undefined || raw === '') return null;
      if (!isNaN(Number(raw))) return Number(raw);
      const name = String(raw).trim().replace(/'/g, "''");
      if (!name) return null;
      const found = await DBSendResponse(`SELECT TOP 1 external_company_id FROM external_referral_company WHERE company_name = '${name}'`);
      if (found && found[0] && found[0].external_company_id) return found[0].external_company_id;
      const ins = await DBSendResponse(`INSERT INTO external_referral_company (company_name) OUTPUT Inserted.external_company_id AS id VALUES ('${name}')`);
      return ins && ins[0] ? ins[0].id : null;
    };

    const initExtId = initCom ? null : await resolveExternalCompanyId(initExtRaw);
    const recvExtId = recvCom ? null : await resolveExternalCompanyId(recvExtRaw);

    const subject = (req.body.referral_subject || 'Referral').replace(/'/g, "''");
    const customerNameRaw = req.body.customer_name || req.body.client_name;
    const customerName = customerNameRaw ? String(customerNameRaw).replace(/'/g, "''") : null;
    const date = (req.body.referral_date || moment().format('YYYY-MM-DD'));
    const status = (req.body.referral_status || 'ACTIVE').replace(/'/g, "''");
    const dataField = JSON.stringify(req.body.data || {}).replace(/'/g, "''");

    const insertReferralQ = `INSERT INTO referral (
      referral_subject,
      referral_date,
      referral_status,
      data,
      customer_name
    ) OUTPUT Inserted.referral_id AS referral_id
    VALUES (
      '${subject}',
      '${date}',
      '${status}',
      '${dataField}',
      ${customerName ? `'${customerName}'` : 'NULL'}
    );`;

    const result = await DBSendResponse(insertReferralQ);
    const newId = Array.isArray(result) && result[0]?.referral_id ? result[0].referral_id : null;
    if (!newId) return res.status(500).json({ message: 'Failed to create referral' });

    const initiatorQ = `INSERT INTO referral_party (referral_id, com_id, external_com_id, role)
      VALUES (${newId}, ${initCom ? initCom : 'NULL'}, ${initExtId ? initExtId : 'NULL'}, 'initiator')`;
    const receiverQ = `INSERT INTO referral_party (referral_id, com_id, external_com_id, role)
      VALUES (${newId}, ${recvCom ? recvCom : 'NULL'}, ${recvExtId ? recvExtId : 'NULL'}, 'receiver')`;

    try {
      await DBSendResponse(initiatorQ);
      await DBSendResponse(receiverQ);
    } catch (partyErr) {
      // Roll back on failure
      await DBUpdate(`DELETE FROM referral_party WHERE referral_id = ${newId}`);
      await DBUpdate(`DELETE FROM referral WHERE referral_id = ${newId}`);
      throw partyErr;
    }

    // Fire-and-forget Customer.io transactional message if details provided
    try {

      const coordinatorEmpId = parseInt(req.body.referral_coordinator_emp_id) || null;
      let referral_email = null;
      if (coordinatorEmpId) {
        const coordintorEmailQuery = `SELECT empEmail FROM employee WHERE emp_id = ${coordinatorEmpId}`;
        const coordRows = await DBSendResponse(coordintorEmailQuery);
        referral_email = coordRows?.[0]?.empEmail || null;
      }

      const transactionalMessageId = 'incoming_referral'
      const request = new SendEmailRequest({
        transactional_message_id: transactionalMessageId,
        message_data: {
          client_name: req.body.client_name || '',
          company_name: req.body.receiving_company_name || ''
        },
        identifiers: {
          id: req.body.referral_coordinator_emp_id ? String(req.body.referral_coordinator_emp_id) : '0'
        },
      to: req.body.referral_email || referral_email
    });
      let response = await api.sendEmail(request);
      console.log('Customer.io email response:', response);
    } catch (cioErr) {
      console.log('Customer.io transactional email failed (non-fatal):', cioErr.message);
    }

    res.json({ code: 200, referral_id: newId });
  } catch (err) {
    console.error('Error adding referral:', err);
    res.status(500).json({ message: 'Error adding referral' });
  }
};

// Create a referral where one party is an external company.
// Body expects:
// - company_id: internal company id
// - external_company_id OR external_company_name: external company reference
// - external_as: 'receiver' or 'initiator' (role of the external company)
// - referral_subject, referral_date (YYYY-MM-DD), referral_status, data
exports.addExternalReferral = async function (req, res) {
  const db = require('../models/indexSQL.js');
  let tx;
  try {
    const internalComId = Number(req.body.company_id);
    const externalIdRaw = req.body.external_company_id;
    const externalNameRaw = req.body.external_company_name || req.body.external_name; // legacy
    const externalNameSafe = externalNameRaw ? String(externalNameRaw).trim().replace(/'/g, "''") : null;
    const externalAs = String(req.body.external_as || '').toLowerCase();

    if (!internalComId) {
      console.log('[ExternalReferral] Missing internal company_id');
      
      return res.status(400).json({ message: 'company_id (internal) is required' });
    }
    if (!externalIdRaw && !externalNameSafe) {
      console.log('[ExternalReferral] Missing external company reference');
      return res.status(400).json({ message: 'Provide external_company_id or external_company_name' });
    }
    if (!['receiver', 'initiator'].includes(externalAs)) {
      console.log('[ExternalReferral] Invalid external_as value:', externalAs);
      return res.status(400).json({ message: "external_as must be 'receiver' or 'initiator'" });
    }

    const subject = (req.body.referral_subject || 'Referral').replace(/'/g, "''");
    const date = (req.body.referral_date || moment().format('YYYY-MM-DD'));
    const status = (req.body.referral_status || 'ACTIVE').replace(/'/g, "''");
    const dataField = JSON.stringify(req.body.data || {}).replace(/'/g, "''");
    const customerNameRaw = req.body.customer_name || req.body.client_name;
    const customerName = customerNameRaw ? String(customerNameRaw).replace(/'/g, "''") : null;

    const dataObj = req.body.data || {};
    const extAddress = dataObj.external_company_address ? String(dataObj.external_company_address).replace(/'/g, "''") : null;
    const extPhone = dataObj.external_company_phone ? String(dataObj.external_company_phone).replace(/'/g, "''") : null;
    const extEmail = dataObj.external_company_email ? String(dataObj.external_company_email).replace(/'/g, "''") : null;

    tx = new db.Transaction();
    await tx.begin();
    const exec = async (q) => {
      const rs = await new db.Request(tx).query(q);
      return rs.recordset;
    };

    // Resolve or create external company record
    let externalCompanyId = null;
    if (externalIdRaw && !isNaN(Number(externalIdRaw))) {
      externalCompanyId = Number(externalIdRaw);
      // Optionally verify exists
      const chk = await exec(`SELECT TOP 1 external_company_id FROM external_referral_company WHERE external_company_id = ${externalCompanyId}`);
      if (!chk || chk.length === 0) {
        if (!externalNameSafe) {
          await tx.rollback();
          return res.status(400).json({ message: 'External company id not found; provide external_company_name to create' });
        }
        const ins = await exec(`INSERT INTO external_referral_company (company_name, company_address, company_phone, referral_contact_email) OUTPUT Inserted.external_company_id AS id VALUES ('${externalNameSafe}', ${extAddress ? `'${extAddress}'` : 'NULL'}, ${extPhone ? `'${extPhone}'` : 'NULL'}, ${extEmail ? `'${extEmail}'` : 'NULL'})`);
        externalCompanyId = ins[0].id;
      }
    } else {
      // Look up by name, else create
      const found = await exec(`SELECT TOP 1 external_company_id FROM external_referral_company WHERE company_name = '${externalNameSafe}'`);
      if (found && found[0] && found[0].external_company_id) {
        externalCompanyId = found[0].external_company_id;
      } else {
        const ins = await exec(`INSERT INTO external_referral_company (company_name, company_address, company_phone, referral_contact_email) OUTPUT Inserted.external_company_id AS id VALUES ('${externalNameSafe}', ${extAddress ? `'${extAddress}'` : 'NULL'}, ${extPhone ? `'${extPhone}'` : 'NULL'}, ${extEmail ? `'${extEmail}'` : 'NULL'})`);
        externalCompanyId = ins[0].id;
      }
    }

    // Insert referral
    const refIns = await exec(`INSERT INTO referral (referral_subject, referral_date, referral_status, data, customer_name)
      OUTPUT Inserted.referral_id AS referral_id
      VALUES ('${subject}', '${date}', '${status}', '${dataField}', ${customerName ? `'${customerName}'` : 'NULL'})`);
    const referralId = refIns && refIns[0] && refIns[0].referral_id;
    if (!referralId) {
      await tx.rollback();
      return res.status(500).json({ message: 'Failed to create referral' });
    }

    // Parties: one internal, one external, roles per external_as
    const externalRole = externalAs === 'receiver' ? 'receiver' : 'initiator';
    const internalRole = externalAs === 'receiver' ? 'initiator' : 'receiver';

    await exec(`INSERT INTO referral_party (referral_id, com_id, external_com_id, role)
      VALUES (${referralId}, ${internalComId}, NULL, '${internalRole}')`);
    await exec(`INSERT INTO referral_party (referral_id, com_id, external_com_id, role)
      VALUES (${referralId}, NULL, ${externalCompanyId}, '${externalRole}')`);


    await tx.commit();

    // Fire-and-forget Customer.io transactional message if details provided (after commit, so a failed email can't undo the referral)
    try {
      const transactionalMessageId = 'outgoing_referral';
        const request = new SendEmailRequest({
        transactional_message_id: transactionalMessageId,
        message_data: {
          employee_name: req.body.employee_name || '',
          company_name: externalNameRaw || ''
        },
        identifiers: {
          id: req.body.customer_id ? String(req.body.customer_id) : '0'
        },
        to: req.body.employee_email + ', ' + req.body.customer_email
      });
      let response = await api.sendEmail(request);
      console.log('Customer.io email response:', response);
    } catch (cioErr) {
      console.log('Customer.io transactional email failed (non-fatal):', cioErr.message);
    }

    res.json({ code: 200, referral_id: referralId, external_company_id: externalCompanyId });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) {} }
    console.error('Error adding external referral:', err);
    res.status(500).json({ message: 'Error adding external referral' });
  }
};

exports.updateReferral = async function (req, res) {
  try {
    const id = parseInt(req.body.referral_id);
    const data = {
      referral_subject: req.body.referral_subject,
      referral_date: req.body.referral_date,
      referral_status: req.body.referral_status,
      data: JSON.stringify(req.body.data || {}),
      customer_name: req.body.customer_name
    };
    const query = generateUpdateSQL('referral', data, `referral_id = ${id}`);
    await DBSendResponse(query);
    res.json({ code: 200, message: 'Update Success' });
  } catch (err) {
    console.error('Error updating referral:', err);
    res.status(500).json({ code: 500, message: 'Update failed' });
  }
};

exports.updateReferralStatus = async function (req, res) {
  try {
    const id = parseInt(req.params.id || req.body.referral_id);
    if (!id) {
      return res.status(400).json({ code: 400, message: 'referral_id is required' });
    }

    const rawStatus = (req.body.referral_status || req.body.status || '').toString().trim().toUpperCase();
    const VALID_STATUSES = [
      'REFERRAL_INITIATED',
      'INITIAL_CONTACT',
      'DOCUMENTATION_PENDING',
      'DOCUMENTATION_RECEIVED',
      'DETERMINATION_PENDING',
      'ACCEPTED',
      'DENIED',
      'ON_HOLD',
      'INTAKE_IN_PROGRESS',
      'CLOSED',
      'PENDING',
      'COMPLETED',
    ];
    if (!VALID_STATUSES.includes(rawStatus)) {
      return res.status(400).json({ code: 400, message: `Invalid referral status. Allowed values: ${VALID_STATUSES.join(', ')}.` });
    }

    const noteValue = (req.body.note ?? req.body.notes ?? '').toString().trim();
    const existingRows = await DBSendResponse(`SELECT data FROM referral WHERE referral_id = ${id}`);
    const existingData = existingRows?.[0]?.data ? (() => {
      try {
        return JSON.parse(existingRows[0].data);
      } catch {
        return {};
      }
    })() : {};
    const nextData = { ...existingData };
    if (noteValue) {
      nextData.notes = noteValue;
    } else if (Object.prototype.hasOwnProperty.call(nextData, 'notes')) {
      delete nextData.notes;
    }

    const dataJson = JSON.stringify(nextData).replace(/'/g, "''");
    const query = `UPDATE referral SET referral_status = '${rawStatus}', data = '${dataJson}' WHERE referral_id = ${id}`;
    await DBUpdate(query);

    console.log(query);
    
    res.json({ code: 200, referral_id: id, referral_status: rawStatus, data: nextData });
  } catch (err) {
    console.error('Error updating referral status:', err);
    res.status(500).json({ code: 500, message: 'Failed to update referral status' });
  }
};

exports.deleteReferral = async function (req, res) {
  try {
    const id = parseInt(req.params.id);
  await DBUpdate(`DELETE FROM referral_party WHERE referral_id = ${id}`);
  const out = await DBUpdate(`DELETE FROM referral WHERE referral_id = ${id}`);
    if (out === 0) {
      return res.status(404).json({ code: 404, message: 'Referral not found' });
    }
    res.json({ code: 200, message: 'Delete Success' });
  } catch (err) {
    console.error('Error deleting referral:', err);
    res.status(500).json({ code: 500, message: 'Delete failed' });
  }
};

exports.createInboundReferralTask = async function (req, res) {
  try {
    // Assume agency name is provided in the request; prefer these keys in order
    const providedAgencyNameRaw = req.body.initiating_company_name || null;
    const providedAgencyName = providedAgencyNameRaw ? String(providedAgencyNameRaw).trim() : null;

    const db = require('../models/indexSQL.js');
    let tx;
    try {
      tx = new db.Transaction();
      await tx.begin();
      const exec = async (q) => {
        console.log('[ReferralTask TX QUERY]', q);
        const rs = await new db.Request(tx).query(q);
        return rs.recordset;
      };

      const companyId = Number(req.body.company_id);
      const employeeId = Number(req.body.employee_id) || null; // referral coordinator passed in body
      if (!companyId) {
        await tx.rollback();
        return res.status(400).json({ message: 'company_id is required to create prospect customer/project' });
      }

      const rawName = req.body.customer_name || 'Prospect Referral';
      const name = String(rawName).replace(/'/g, "''");
      // Build address string if provided
      let addressStr = null;
      if (Array.isArray(req.body.address) && req.body.address.length > 0) {
        try {
          addressStr = req.body.address
            .map(add => {
              const a1 = (add.address_line_1 || '').replace(/'/g, "''");
              const a2 = (add.address_line_2 || '').replace(/'/g, "''");
              const city = (add.city || '').replace(/'/g, "''");
              const state = (add.state || '').replace(/'/g, "''");
              const zip = (add.zip || '').replace(/'/g, "''");
              return `${a1},${a2},${city},${state},${zip}`;
            })
            .join(':');
        } catch (_) { addressStr = null; }
      }

      // Insert prospect customer
      const insertCustomerQ = `INSERT INTO customer (
        cus_name, cus_address, cus_email, cus_phone, cus_acquired_date, cus_status, cus_type, cus_created_at, cus_company_id, cus_is_company, cus_is_active
      ) OUTPUT Inserted.cus_id AS cus_id VALUES (
        '${name}', ${addressStr ? `'${addressStr}'` : 'NULL'}, NULL, NULL, GETDATE(), 'Prospect', 'Individual', GETDATE(), ${companyId}, 'false', 1
      )`;
      const custRs = await exec(insertCustomerQ);
      const cus_id = custRs && custRs[0] && custRs[0].cus_id;
      if (!cus_id) {
        await tx.rollback();
        return res.status(500).json({ message: 'Failed to create prospect customer' });
      }

      // Insert sample intake/referral project
      const insertProjectQ = `
        INSERT INTO project (
            pro_title, pro_description, pro_starts_on, pro_ends_on,
            pro_currency, pro_price, pro_is_active, pro_created_at, pro_updated_at,
            pro_customer_id, pro_sponsors_id, pro_contact_id, pro_manager_id, pro_com_id,
            DDD_plan_id, DDD_ID, DDD_budget_amt, last_plan_modified_date, first_billing_date,
            plan_program_name, plan_approval_date, medicaid_approv_date, active_plan_allocated, active_plan_budget,
            active_plan_version, curr_plan_allocated, curr_plan_budget, curr_plan, curr_plan_version,
            medicaid_prgm_status_code, active_plan_expended, pro_updated_by, pro_created_by, Program,
            LastMCType, LastMCDate, LastMMTUploadDate, active_plan_startdate, active_plan_duedate,
            LastAnnualVisitDate, pro_status, active_plan_creation_date, active_plan_status,
            pro_self_pay, pro_primary_payer, pro_secondary_payer
        )
        OUTPUT Inserted.pro_id AS pro_id
        VALUES (
            'Intake Project for ${name}', 'Created for intake', GETDATE(), DATEADD(day, 365, GETDATE()),
            'USD', 0, 0, GETDATE(), GETDATE(),
            ${cus_id}, NULL, NULL, ${employeeId ? employeeId : 'NULL'}, ${companyId},
            NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, NULL,
            '1', NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL,
            NULL, NULL, NULL
        );
      `;
      const projRs = await exec(insertProjectQ);
      const pro_id = projRs && projRs[0] && projRs[0].pro_id;
      if (!pro_id) {
        await tx.rollback();
        return res.status(500).json({ message: 'Failed to create intake project' });
      }

  // Use provided agency name for description (initiator)
  const desc = providedAgencyName ? `From ${providedAgencyName.replace(/'/g, "''")}` : 'Inbound referral';

      // Insert inbound referral intake task
      const insertTaskQ = 
        'INSERT INTO task (tas_title, tas_description, tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time, tas_priority, ' +
        'tas_billable_by_default, tas_notes, tas_is_active, tas_created_at, tas_pro_id, tas_emp_id, tas_loc_id, tas_loc1_id, tas_loc2_id, tas_prequisites_task, tas_created_by, tas_com_id, tas_mm_id, tas_required_sig, tas_cus_id) ' +
        'OUTPUT Inserted.tas_id AS task_id ' +
        'VALUES (' +
        "'" + 'Inbound referral' + "'," +
        "'" + desc.replace(/'/g, "''") + "'," +
        "'" + 'Intake' + "'," +
        'GETDATE(),' +
        'DATEADD(day,30,GETDATE()),' +
        'GETDATE(),' +
        'DATEADD(day,30,GETDATE()),' +
        "'" + 'Med' + "'," +
        "'" + (0) + "'," +
        "'" + '' + "'," +
        (1) + "," +
        'GETDATE(),' +
        (pro_id) + "," +
        (employeeId || 'NULL')  + "," +
        ('NULL') + "," +
        ('NULL') + "," +
        ('NULL') + "," +
        ('NULL') + "," +
        (employeeId || 'NULL') + "," +
        (companyId) + "," +
        ('NULL') + "," +
        (0) + "," +
        (cus_id) +
        ');';

      const taskRs = await exec(insertTaskQ);
      const task_id = taskRs && taskRs[0] && taskRs[0].task_id;
      if (!task_id) {
        await tx.rollback();
        return res.status(500).json({ message: 'Failed to create inbound referral task' });
      }

      await tx.commit();

      return res.json({ code: 200, task_id, customer_id: cus_id, project_id: pro_id });
    } catch (err) {
      if (tx) { try { await tx.rollback(); } catch (rbErr) { console.error('[ReferralTask TX] Rollback failed', rbErr.message); } }
      console.error('Error creating inbound referral task with prospect/project:', err);
      return res.status(500).json({ message: 'Error creating inbound referral task (prospect/project)' });
    }
  } catch (err) {
    console.error('Error creating inbound referral task:', err);
    res.status(500).json({ message: 'Error creating inbound referral task' });
  }
};

exports.createOutboundReferralTask = async function (req, res) {
  console.log('[OutboundReferral] createOutboundReferralTask called', req.body);
  
  try {
    const cusIdValRaw = req.body.customer_id || req.body.cus_id;
    const companyId = Number(req.body.company_id);
    const employeeId = req.body.employee_id || 'NULL';

    console.log('[OutboundReferral] createOutboundReferralTask called with', { cusIdValRaw, companyId, employeeId });
    

    if (!cusIdValRaw || !companyId) {
      console.log('Outbound referral missing customer_id or company_id:', { cusIdValRaw, companyId });
      
      return res.status(400).json({ message: 'customer_id and company_id are required' });
    }

    // Resolve receiving agency name for description "To <agency>"
    let targetAgencyName = null;
    if (req.body.receiving_company_id) {
      const rcid = Number(req.body.receiving_company_id);
      if (!isNaN(rcid)) {
        try {
          const rows = await DBSendResponse(`SELECT TOP 1 com_name FROM company WHERE com_id = ${rcid}`);
          targetAgencyName = rows && rows[0] && rows[0].com_name ? rows[0].com_name : null;
        } catch (_) {}
      }
    }
    if (!targetAgencyName) {
      targetAgencyName = req.body.receiving_company_name || req.body.receiving_external_name || null;
    }
    const desc = targetAgencyName ? `To ${String(targetAgencyName).replace(/'/g, "''")}` : 'Outbound referral';

    // Determine project: prefer active project, fall back to any project, then proceed with NULL
    const cusIdVal = Number(cusIdValRaw);
    let proIdVal = null;
    try {
      const activeRows = await DBSendResponse(`SELECT TOP 1 pro_id FROM project WHERE pro_customer_id = ${cusIdVal} AND pro_is_active = 1 ORDER BY pro_id DESC`);
      proIdVal = activeRows && activeRows[0] && activeRows[0].pro_id ? activeRows[0].pro_id : null;
      if (!proIdVal) {
        const anyRows = await DBSendResponse(`SELECT TOP 1 pro_id FROM project WHERE pro_customer_id = ${cusIdVal} ORDER BY pro_id DESC`);
        proIdVal = anyRows && anyRows[0] && anyRows[0].pro_id ? anyRows[0].pro_id : null;
      }
    } catch (_) { proIdVal = null; }
    if (!proIdVal) {
      console.log('Outbound referral: no project found for customer, proceeding with NULL pro_id:', { cusIdVal });
    }

    const q = 
      'INSERT INTO task (tas_title, tas_description, tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time, tas_priority, ' +
      'tas_billable_by_default, tas_notes, tas_is_active, tas_created_at, tas_pro_id, tas_emp_id, tas_loc_id, tas_loc1_id, tas_loc2_id, tas_prequisites_task, tas_created_by, tas_com_id, tas_mm_id, tas_required_sig, tas_cus_id) ' +
      'VALUES (' +
      "'" + 'Outbound referral' + "'," +
      "'" + desc + "'," +
      "'" + 'Intake' + "'," +
      'GETDATE(),' +
      'DATEADD(day,30,GETDATE()),' +
      'GETDATE(),' +
      'DATEADD(day,30,GETDATE()),' +
      "'" + 'Med' + "'," +
      "'" + (0) + "'," +
      "'" + '' + "'," +
      (1) + "," +
      'GETDATE(),' +
      (proIdVal) + "," +
      (employeeId)  + "," +
      ('NULL') + "," +
      ('NULL') + "," +
      ('NULL') + "," +
      ('NULL') + "," +
      (employeeId) + "," +
      (companyId) + "," +
      ('NULL') + "," +
      (0) + "," +
      (cusIdVal) +
      "); SELECT SCOPE_IDENTITY() AS task_id;";

    const taskId = await DBinsertSendID(q);

    try { await api.triggerBroadcast(IN_APP_MESSAGE_REFERRAL_ID, {}, { ids: [String(req.body.employee_id || '')].filter(Boolean) }); } catch (cioErr) { console.warn('Customer.io broadcast failed (non-fatal):', cioErr.message); }

    res.json({ code: 200, task_id: taskId });
  } catch (err) {
    console.error('Error creating outbound referral task:', err);
    res.status(500).json({ message: 'Error creating outbound referral task' });
  }
};
