const db = require('../models/indexSQL.js');
const moment = require('moment');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, generateInsertSQL, generateUpdateSQL, DBSendResponseParam } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const { addcompany } = require('../queries/dependantQueries');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
// const {updateLocation} = require('./location')

exports.getCompTables = async function (req, res) {
  const compList = await getCompList(req.query.comp_id);
  res.json(compList);
};

exports.addOneCompany = async function (req, res) {
  addcompany(req, res);
};

exports.updateCompany = async function (req, res) {
  // updateOneCompany(req,res)
  updateOneCompanyv1(req, res);
};

exports.deleteCompany = async function (req, res) {
  delOneCompany(req, res);
};
async function getCompList(com_id) {
  const query = `SELECT * from company as a,location as b
                where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY' `;

  // !!req.query.comp_id -> !!<- checks for null or undefined and the empty chars
  if (com_id) {
    var compList = await DBSendResponse(query);
  }

  return compList;
}

async function updateOneCompany(req, res) {
  const query = `UPDATE company 
				SET 
					com_name='${req.body.com_name}',
					com_is_active='${req.body.com_is_active}',
					com_taxid='${req.body.provider_tax_id}'			
				WHERE com_id = ${req.body.com_id}`;
  // payerId='${req.body.payer_id}'
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

async function updateOneCompanyv1(req, res) {
  try {
    const update_loc_query = `UPDATE location 
	SET 
		loc_addr_line1='${req.body.loc_addr_line1}',
		loc_addr_line2='${req.body.loc_addr_line2}',
		loc_city='${req.body.loc_city}',
		loc_state='${req.body.loc_state}',
		loc_zip='${req.body.loc_zip}',
		loc_lat=${req.body.loc_lat},
		loc_lon=${req.body.loc_lon},
		loc_is_active='true',
		loc_phone_number='${req.body.loc_phone_number}'
	WHERE loc_id = ${req.body.loc_id}`;
    const updateStatus = await DBUpdate(update_loc_query);
    if (updateStatus === 0) {
      res.json({ code: 500, message: 'Update failed' });
    } else {
      // update company information provided by request fill missing body params with old details
      const query = `UPDATE company 
		SET 
			com_name='${req.body.com_name}',
			com_is_active='${req.body.com_is_active}',
			com_taxid='${req.body.com_taxid}',
			payCycle='${req.body.payCycle}',
			startoftheWeek=${req.body.startoftheWeek || 0},
			payerId=${req.body.payerId ? req.body.payerId : 'NULL'},
			subscriptionPlan=${req.body.subscriptionPlan ? req.body.subscriptionPlan : 'NULL'},
			subscriptionStartDate=${req.body.subscriptionStartDate ? `'${req.body.subscriptionStartDate}'` : 'NULL'},
			subscriptionEndDate=${req.body.subscriptionEndDate ? `'${req.body.subscriptionEndDate}'` : 'NULL'},
			trialStartDate=${req.body.trialStartDate ? `'${req.body.trialStartDate}'` : 'NULL'},
			trialEndDate=${req.body.trialEndDate ? `'${req.body.trialEndDate}'` : 'NULL'}
		WHERE com_id = ${req.body.com_id}`;
      const out = await DBUpdate(query);
      if (out === 0) {
        res.json({ code: 500, message: 'Update failed' });
      } else {
        let com_id = req.body.company_id, emp_id = req.body.emp_id;
        if (com_id && emp_id) {
          analytics.track({
            userId: String(emp_id),
            event: 'Company information updated',
            context: {
              groupId: com_id,
            },
            properties: {
              companyName: req.body.com_name,
            }
          });
        }
        res.json({ code: 200, message: 'Update Success' });
      }
    }
  } catch (err) {
    console.log(err);
    res.json({ code: 500, message: 'Update failed' });
  }
}

async function delOneCompany(req, res) {
  const booleanValue = req.body.bval;
  const id = req.body.id;
  const query = `UPDATE company SET com_is_active = '${booleanValue}' WHERE com_id = ${id}`;
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

exports.getOfficeLocation = async function (req, res) {
  const query = `select * from office_location where oloc_company_id = ${req.query.company_id}`;

  let result = await DBSendResponse(query);

  res.json(result);
};

exports.addOfficeLocation = async function (req, res) {
  const data = {
    'oloc_addr_line1': generateSQLText(req.body.oloc_addr_line1, 255, null),
    'oloc_addr_line2': generateSQLText(req.body.oloc_addr_line2, 255, null),
    'oloc_city': generateSQLText(req.body.oloc_city, 255, null),
    'oloc_state': generateSQLText(req.body.oloc_state, 255, null),
    'oloc_zip': generateSQLText(req.body.oloc_zip, 255, null),
    'oloc_type': generateSQLText(req.body.oloc_type, 255, null),
    'oloc_status': parseInt(req.body.oloc_status),
    'oloc_county': generateSQLText(req.body.oloc_county, 255, null),
    'oloc_association_date': req.body.oloc_association_date,
    'oloc_phone_number': generateSQLText(req.body.oloc_phone_number, 255, null),
    'oloc_company_id': parseInt(req.body.oloc_company_id),
    'oloc_is_active': parseInt(req.body.oloc_is_active),
    'oloc_facilityType': generateSQLText(req.body.oloc_facilityType, 255, null),
    'oloc_facilityCodeQualifier': generateSQLText(req.body.oloc_facilityCodeQualifier, 255, null),
  };
  const query = generateInsertSQL('office_location', data) + 'SELECT SCOPE_IDENTITY()';

  try {
    const newOfficeLocId = await DBinsertSendID(query);
    res.status(200).json({
      id: newOfficeLocId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addOfficeLocation Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.updateOfficeLocation = async function (req, res) {
  const data = {
    'oloc_addr_line1': generateSQLText(req.body.oloc_addr_line1, 255, null),
    'oloc_addr_line2': generateSQLText(req.body.oloc_addr_line2, 255, null),
    'oloc_city': generateSQLText(req.body.oloc_city, 255, null),
    'oloc_state': generateSQLText(req.body.oloc_state, 255, null),
    'oloc_zip': generateSQLText(req.body.oloc_zip, 255, null),
    'oloc_type': generateSQLText(req.body.oloc_type, 255, null),
    'oloc_status': parseInt(req.body.oloc_status),
    'oloc_county': generateSQLText(req.body.oloc_county, 255, null),
    'oloc_association_date': req.body.oloc_association_date,
    'oloc_phone_number': generateSQLText(req.body.oloc_phone_number, 255, null),
    'oloc_company_id': parseInt(req.body.oloc_company_id),
    'oloc_is_active': parseInt(req.body.oloc_is_active),
    'oloc_facilityType': generateSQLText(req.body.oloc_facilityType, 255, null),
    'oloc_facilityCodeQualifier': generateSQLText(req.body.oloc_facilityCodeQualifier, 255, null),
  };
  const query = generateUpdateSQL('office_location', data, `oloc_id = ${parseInt(req.body.oloc_id)}`);

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Office Location updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateOfficeLocation Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getProvider = async function (req, res) {
  const query = `select * from provider_identifier where prov_iden_company_id = ${req.query.company_id}`;

  let result = await DBSendResponse(query);

  res.json(result);
};

exports.addProvider = async function (req, res) {
  const data = {
    'prov_name': generateSQLText(req.body.prov_name, 255, null),
    'prov_iden': generateSQLText(req.body.prov_iden, 255, null),
    'prov_iden_type': generateSQLText(req.body.prov_iden_type, 255, null),
    'prov_iden_issuing_entity': generateSQLText(req.body.prov_iden_issuing_entity, 255, null),
    'prov_iden_start_date': req.body.prov_iden_start_date ? req.body.prov_iden_start_date : moment().format('YYYY-MM-DD HH:mm:ss.SSS'),
    'prov_iden_end_date': req.body.prov_iden_end_date ? req.body.prov_iden_end_date : moment().format('YYYY-MM-DD HH:mm:ss.SSS'),
    'prov_iden_company_id': parseInt(req.body.prov_iden_company_id),
    'prov_iden_status': parseInt(req.body.prov_iden_status),
  };
  const query = generateInsertSQL('provider_identifier', data) + 'SELECT SCOPE_IDENTITY()';

  try {
    if (req.body.is_default_for_private_payer === true) {
      const check_if_exists = await DBSendResponse(`SELECT prov_iden_id FROM provider_identifier WHERE prov_iden_company_id=${parseInt(req.body.prov_iden_company_id)} AND prov_iden='999999' AND prov_iden_type='NPI' AND prov_iden_issuing_entity='NPI'`);
      if (check_if_exists.length > 0) {
        return res.status(200).json({
          id: check_if_exists[0].prov_iden_id
        });        
      }
    } 
    console.log(query);
    const newProviderId = await DBinsertSendID(query);
    console.log(newProviderId);
    res.status(200).json({
      id: newProviderId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addProvider Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.updateProvider = async function (req, res) {
  const data = {
    'prov_name': generateSQLText(req.body.prov_name, 255, null),
    'prov_iden': generateSQLText(req.body.prov_iden, 255, null),
    'prov_iden_type': generateSQLText(req.body.prov_iden_type, 255, null),
    'prov_iden_issuing_entity': generateSQLText(req.body.prov_iden_issuing_entity, 255, null),
    'prov_iden_start_date': req.body.prov_iden_start_date,
    'prov_iden_end_date': req.body.prov_iden_end_date,
    'prov_iden_status': parseInt(req.body.prov_iden_status),
  };
  const query = generateUpdateSQL('provider_identifier', data, `prov_iden_id = ${parseInt(req.body.prov_iden_id)}`);

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Provider updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateProvider Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.deleteProvider = async function (req, res) {
  if (req.body.comp_id && !req.body.prov_iden_id) {
    await deleteDefaultPrivatePayerContract(req, res);
  }
};

exports.getLogo = async function (req, res) {
  if (!req.params.company_id) {
    res.status(400).json({
      message: 'Missing required fields'
    });
    return;
  }

  const params = {
    'com_id': parseInt(req.params.company_id),
  };
  const query = 'select * from company_logo where com_id = @com_id';

  let result = await DBSendResponseParam(query, params);
    
  res.status(200).json(result[0] || {});
};

exports.addLogo = async function (req, res) {
  
  if(!req.file || !req.params.company_id) {
    res.status(400).json({
      message: 'Missing required fields'
    });
    return;
  }

  if(req.file.size > 1 * 1024 * 1024) {
    res.status(400).json({
      message: 'File size too large'
    });
    return;
  }
  
  const params = {
    'com_id': parseInt(req.params.company_id),
    'logo': req.file.buffer.toString('hex'),
    'type': req.file.mimetype
  };
  
  const query = 'INSERT INTO company_logo (com_id, logo, type) VALUES (@com_id, CONVERT(VARBINARY(MAX), @logo, 2), @type)';

  try {
    const newLogoId = await DBSendResponseParam(query, params);
    
    res.status(200).json({
      id: newLogoId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addLogo Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.updateLogo = async function (req, res) {
  if(!req.file || !req.params.company_id) {
    res.status(400).json({
      message: 'Missing required fields'
    });
    return;
  }

  if(req.file.size > 1 * 1024 * 1024) {
    res.status(400).json({
      message: 'File size too large'
    });
    return;
  }

  const params = {
    'logo': req.file.buffer.toString('hex'),
    'date_added': moment().format('YYYY-MM-DD HH:mm:ss'),
    'type': req.file.mimetype
  };

  const query = `UPDATE company_logo SET logo = CONVERT(VARBINARY(MAX), @logo, 2), date_added = @date_added, type = @type WHERE com_id = ${req.params.company_id}`;
  
  try {
    await DBSendResponseParam(query, params);
    res.status(200).json({
      message: 'Logo updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateLogo Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.deleteLogo = async function (req, res) {
  if(!req.params.company_id) {
    res.status(400).json({
      message: 'Missing required fields'
    });
    return;
  }

  const params = {
    'com_id': parseInt(req.params.company_id),
  };

  const query = 'DELETE FROM company_logo WHERE com_id = @com_id';

  try {
    await DBSendResponseParam(query, params);
    res.status(200).json({
      message: 'Logo deleted successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | deleteLogo Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

async function deleteDefaultPrivatePayerContract(req, res) {
  const query = `DELETE FROM provider_identifier WHERE prov_iden_company_id = ${req.body.comp_id} AND prov_iden = '999999' AND prov_iden_type='NPI' AND prov_iden_issuing_entity='NPI'`;
  try {
    console.log(query);
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Default Private Payer deleted successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | deletePrivatePayerContract Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
}

exports.writeCompanyUsage= async function(company_id, month = null){
  try {
    const usageMonth = moment(month || undefined).startOf('month').format('YYYY-MM-DD');
    const startOfMonth = moment(usageMonth).format('YYYY-MM-DD HH:mm:ss');
    const startOfNextMonth = moment(usageMonth).add(1, 'month').format('YYYY-MM-DD HH:mm:ss');

    const [employees, tasks, notes, documents, claims, sessions, storage] = await Promise.all([
      DBSendResponse(`SELECT COUNT(*) as count FROM employee WHERE emp_company_id = ${company_id} AND emp_is_active = 'true'`),
      DBSendResponse(`SELECT COUNT(*) as count FROM task WHERE tas_com_id = ${company_id} AND tas_created_at >= '${startOfMonth}' AND tas_created_at < '${startOfNextMonth}'`),
      DBSendResponse(`SELECT COUNT(*) as count FROM comments c INNER JOIN employee e ON c.emp_id = e.emp_id WHERE e.emp_company_id = ${company_id} AND c.created_at >= '${startOfMonth}' AND c.created_at < '${startOfNextMonth}' AND c.isDeleted = 0`),
      DBSendResponse(`SELECT COUNT(*) as count FROM artifacts a INNER JOIN employee e ON a.employee_id = e.emp_id WHERE e.emp_company_id = ${company_id} AND a.submitted >= '${startOfMonth}' AND a.submitted < '${startOfNextMonth}' AND a.Status = 1`),
      DBSendResponse(`SELECT COUNT(*) as count FROM Claim WHERE companyID = ${company_id} AND SubmitDate >= '${startOfMonth}' AND SubmitDate < '${startOfNextMonth}'`),
      DBSendResponse(`SELECT COUNT(*) as count FROM sessions s INNER JOIN task t ON s.task_id = t.tas_id WHERE t.tas_com_id = ${company_id} AND s.check_in_time >= '${startOfMonth}' AND s.check_in_time < '${startOfNextMonth}'`),
      DBSendResponse(`SELECT ISNULL(COUNT(*) * 12000, 0) as count FROM monthlymonitoring mm INNER JOIN task t ON mm.task_id = t.tas_id WHERE t.tas_com_id = ${company_id}`)
    ]);

    const getValue = (result) => result?.[0]?.count || 0;
    const metrics = {
      employeeCount: getValue(employees),
      tasksCreatedCount: getValue(tasks),
      notesCreatedCount: getValue(notes),
      documentsCreatedCount: getValue(documents),
      claimsSubmittedCount: getValue(claims),
      sessionsScheduledCount: getValue(sessions),
      storageTotalBytes: getValue(storage)
    };

    await DBSendResponse(`
      MERGE INTO fw_usage AS target
      USING (VALUES (${company_id}, '${usageMonth}', ${metrics.employeeCount}, ${metrics.tasksCreatedCount}, 
        ${metrics.notesCreatedCount}, ${metrics.documentsCreatedCount}, ${metrics.claimsSubmittedCount}, 
        ${metrics.sessionsScheduledCount}, ${metrics.storageTotalBytes})) 
      AS source (company_id, usage_month, employee_count, tasks_created_count, notes_created_count, 
        documents_created_count, claims_submitted_count, sessions_scheduled_count, storage_total_bytes)
      ON target.company_id = source.company_id AND target.usage_month = source.usage_month
      WHEN MATCHED THEN UPDATE SET employee_count = source.employee_count, tasks_created_count = source.tasks_created_count, 
        notes_created_count = source.notes_created_count, documents_created_count = source.documents_created_count, 
        claims_submitted_count = source.claims_submitted_count, sessions_scheduled_count = source.sessions_scheduled_count, 
        storage_total_bytes = source.storage_total_bytes, updated_at_utc = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (company_id, usage_month, employee_count, tasks_created_count, notes_created_count, 
        documents_created_count, claims_submitted_count, sessions_scheduled_count, storage_total_bytes)
      VALUES (source.company_id, source.usage_month, source.employee_count, source.tasks_created_count, 
        source.notes_created_count, source.documents_created_count, source.claims_submitted_count, 
        source.sessions_scheduled_count, source.storage_total_bytes);
    `);

    return { success: true, company_id, usage_month: usageMonth, metrics };
  } catch (err) {
    throw new Error(`Failed to write usage for company ${company_id}: ${err.message}`);
  }
};

exports.writeSingleCompanyUsage = async function(req, res) {
  try {
    if (!req.body.company_id) {
      return res.status(400).json({ message: 'company_id is required' });
    }
    const result = await exports.writeCompanyUsage(req.body.company_id, req.body.month);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: 'An unexpected error occurred' });
  }
};

exports.writeAllCompaniesUsage = async function(req, res) {
  try {
    const month = req.body.month || null;
    const companies = await DBSendResponse('SELECT com_id FROM company');

    console.log(companies.length);

    const results = await Promise.allSettled(
      companies.map(company => exports.writeCompanyUsage(company.com_id, month))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    res.status(200).json({
      success: true,
      total: companies.length,
      successful,
      failed,
      month: month || 'current month'
    });
  } catch (err) {
    res.status(500).json({ message: 'An unexpected error occurred' });
  }
};