const db = require('../models/indexSQL.js')
const moment = require('moment')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries')
const { isActualText, parseSQLText, generateSQLText } = require('../utils/validation')

exports.getForm = async (req, res) => {
  let query = `SELECT * from form where form_id = '${req.query.form_id}'`;
  console.log(query)
  const out = await DBSendResponse(query)
  console.log(out)
  res.json(out)
}

exports.addForm = async (req, res) => {
  // Check for errors with data provided
  if (req.body.value === undefined) {
    res.json({ code: 500, message: 'POST failed. Must include \'value\' key in body' })
    return;
  }

  // Create Form
  let query = 'insert into form (value) VALUES (\'' + req.body.value + '\'); SELECT SCOPE_IDENTITY();';
  let newFormID = await DBinsertSendID(query);

  // Create Bridge if Neccessary
  let newFormBridgeID = undefined;
  if (!!req.body.com_id && (!!req.body.tas_type || !!req.body.tas_id)) {
    let query2 = `insert into form_bridge (com_id, form_id, tas_type, tas_id) VALUES(${req.body.com_id},${newFormID},'${(!!req.body.tas_type ? req.body.tas_type : 'NULL')}',${(!!req.body.tas_id ? req.body.tas_id : 'NULL')}); SELECT SCOPE_IDENTITY();`;
    newFormBridgeID = await DBinsertSendID(query2);
  }

  // Handle Response
  if (!!newFormID && !!newFormBridgeID) {
    res.json({ code: 207, message: 'Update Success' })
  }
  else if (!!newFormID)
    res.json({ code: 200, message: 'Update Success' })
}

exports.updateForm = async (req, res) => {
  // Check for errors with data provided
  if (req.body.value === undefined) {
    res.json({ code: 500, message: 'PUT failed. Must include \'value\' key in body' })
    return;
  }
  else if (req.body.form_id === undefined) {
    res.json({ code: 500, message: 'PUT failed. Must include \'form_id\' key in body' })
    return;
  }

  // Perform Update Query
  let query = `UPDATE form SET value=${req.body.value} WHERE form_id=${req.body.value}`;

  // Handle Response
  let out;
  try {
    out = await DBUpdate(query);
  } catch (error) {
    out = 0;
  }

  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

exports.addFormResponse = async (req, res) => {
  if (!req.body.value || !req.body.form_id || !req.body.emp_id) {
    res.json({ code: 500, message: 'Update failed' });
    return;
  }

  let query = `insert into form_response (value,form_id,emp_id,tas_id) VALUES ('${req.body.value}', ${req.body.form_id}, ${req.body.emp_id}, ${req.body.tas_id}); SELECT SCOPE_IDENTITY();`;
  let newFormID = await DBSendResponse(query);

  if (newFormID.length === 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

exports.getFormBridge = async (req, res) => {
  let query = `select * from form_bridge WHERE com_id=${req.query.com_id} AND tas_type='${req.query.tas_type}';`;
  const out = await DBSendResponse(query)
  if (out.length > 0) {
    let query2 = `SELECT * from form where form_id = '${out[0].form_id}'`;
    const out2 = await DBSendResponse(query2)
    res.json(out2)
  }
  else {
    res.json(out)
  }

}

exports.getForm_report = async (req, res) => {
  let query = `SELECT * FROM form_reports WHERE report_company_id = ${req.query.report_company_id}`;
  if (req.query.report_id) {
    query += ` AND report_id = '${req.query.report_id}'`
  }

  try {
    let response = await DBSendResponse(query)
    res.status(200).json(response)
  } catch (err) {
    console.log('QUERY FAILURE | getForm_report Query Failed:')
    console.log(err)
    res.status(500).json({
      message: 'An unexpected error occured'
    })
  }
}

exports.addForm_report = async (req, res) => {
  const data = {
    report_name: generateSQLText(req.body.report_name, 255, 'Form Report'),
    report_header: generateSQLText(req.body.report_header, 255, ''),
    report_subheader1: generateSQLText(req.body.report_subheader1, 255, ''),
    report_subheader2: generateSQLText(req.body.report_subheader2, 255, ''),
    report_owner: parseInt(req.body.report_owner),
    report_form_id: parseInt(req.body.report_form_id),
    report_definition: req.body.report_definition,
    report_company_id: parseInt(req.body.report_company_id),
    report_createdOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
    report_updatedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
    report_status: 1
  };
  const query = generateInsertSQL('form_reports', data) + 'SELECT SCOPE_IDENTITY()'

  try {
    const newForm_reportId = await DBinsertSendID(query)
    res.status(200).json({
      id: newForm_reportId
    })
  } catch (err) {
    console.log('QUERY FAILURE | addForm_report Query Failed:')
    console.log(err)
    res.status(500).json({
      message: 'An unexpected error occured'
    })
  }
}

exports.updateForm_report = async (req, res) => {
  const query = `UPDATE form_reports 
    SET 
      report_definition = '${req.body.report_definition}', 
      report_updatedOn = '${moment().format('YYYY-MM-DDTHH:mm:ss')}' 
    WHERE report_id = '${req.body.report_id}' AND report_company_id = ${parseInt(req.body.report_company_id)}`;

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Form_report updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateForm_report Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
}