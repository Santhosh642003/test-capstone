const { type } = require('express/lib/response');
const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse, DBInsertAndReturn , DBSendResponseParam } = require('../queries/commonQueries');
const moment = require('moment');                                                                                                                                                   
const axios = require('axios');
const { parseSQLText } = require('../utils/validation.js');
                                                                                                                  

exports.insertLog = async (req, res) => {
  const start = performance.now();
  try {
    let date=moment().toDate();
    date=moment(date).utc().format('YYYY-MM-DDTHH:mm:ss');
    let query;
    if(req.body.emp_id!=undefined){
      query = `select * from employee,company where emp_company_id=com_id and emp_id='${req.body.emp_id}'`;
    }
    else{
      query = `select * from employee,company where emp_company_id=com_id and empEmail='${req.body.email}'`;
    }
    req.log.debug(query);
    const user = await DBSendResponse(query);
    if(req.body.actionSubType === 'MT saved') {
      let checkIfPresentQuery = `select fw_log_id from fw_log where company_id = ${user[0].com_id} and employee_id = ${user[0].emp_id} and sessionid = '${req.body.sessionID}' and action_subtype = 'MT saved'`;
      const checkIfPresentResp = await DBinsertSendResponse(checkIfPresentQuery);
      if(checkIfPresentResp.length !== 0) {
        let logIds = checkIfPresentResp;
        logIds = logIds.map((obj) => obj.fw_log_id).sort().reverse();
        let updateQ = `update fw_log set systime = '${date}' where fw_log_id = ${logIds[0]}`;
        const updateR = await DBUpdate(updateQ);
        return res.json({
          code: 200,
          message: 'Ok!',
        });
      }
    }
        
    let log_query=`insert into fw_log (company_id,employee_id,action_type,action_subtype,action_detail,systime,sessionid) values (${user[0].com_id},${user[0].emp_id},'${req.body.actionType}','${parseSQLText(req.body.actionSubType, 255)}','${req.body.actionDetail ? req.body.actionDetail : user[0].empEmail}','${date}','${req.body.sessionID}')`;
    const log = await DBSendResponse(log_query);
    req.log.debug(`/api/fieldworker/activity_log POST TIMETAKEN: ${performance.now() - start} MS`);
    res.json({
      code: 200,
      message: 'Ok!',
    });
  } catch (error) {
    req.log.debug(`/api/fieldworker/activity_log POST ERROR: ${error.message}`);
    req.log.error(error);
    req.log.debug(`/api/fieldworker/activity_log POST TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

exports.getEmpInviteLog = async (req, res) => {
  const query = `
      SELECT *
        FROM fw_log fl
        JOIN employee e on e.emp_id = fl.employee_id
      WHERE fl.employee_id = ${req.query.empID} AND fl.action_type = 'Invite Employee'
    `;

  let result = await DBSendResponse(query);

  res.json(result);
};

exports.getFilteredLogs = async (req, res) => {
  const start = performance.now();
  try {
    const { actionType, actionSubType, actionDetail, employee_id } = req.query;
  
    // Validate that actionType is provided
    if (!actionType) {
      return res.status(400).json({ error: 'actionType is required' });
    }
  
    // Initialize the base query and parameters object
    let query = 'SELECT * FROM fw_log WHERE action_type = @actionType';
    const params = { actionType };
  
    // Add optional filters if provided
    if (actionSubType) {
      query += ' AND action_subtype = @actionSubType';
      params.actionSubType = actionSubType;
    }
  
    if (actionDetail) {
      query += ' AND action_detail = @actionDetail';
      params.actionDetail = actionDetail;
    }

    if (employee_id) {
      query += ' AND employee_id = @employee_id';
      params.employee_id = employee_id;
    }


    query += ' ORDER BY systime DESC';
  
    // Execute the parameterized query
    const logs = await DBSendResponseParam(query, params);
  
    req.log.debug(`/api/fieldworker/logs GET TIMETAKEN: ${performance.now() - start} MS`);
    res.json({
      code: 200,
      data: logs,
    });
  } catch (error) {
    req.log.debug(`/api/fieldworker/logs GET ERROR: ${error.message}`);
    req.log.error(error);
    req.log.debug(`/api/fieldworker/logs GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getRecentDDDSyncLogs = async (req, res) => {

  if (!req.query.company_id) {
    return res.status(400).json({ error: 'company_id is required' });
  }

  const query = `
      SELECT TOP 3 * FROM fw_log
      WHERE action_type='DDDSync ran' and company_id=${req.query.company_id ?? 0}
      ORDER BY systime DESC
    `;

  let result = await DBSendResponse(query);

  console.log(result);

  res.json(result);
};
