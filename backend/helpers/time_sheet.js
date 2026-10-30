const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { addNotif } = require('./notifications');

exports.getTimeSheetTables = async function (req, res) {
  let timeSheetList = [];

  if (req.query.company_id) {
    timeSheetList = await getTimeSheet(req, res);
  } else if (req.query.time_sheet_id) {
    timeSheetList = await getOneTimeSheet(req, res);
  } else if (req.query.emp_id) {
    //get all timesheets for the given emp_id
    const query = `
      SELECT time_sheet.*, pay_period.*
      FROM time_sheet
      LEFT JOIN pay_period ON time_sheet.pay_period_id = pay_period.pay_period_id
      WHERE time_sheet.emp_id = ${req.query.emp_id}
    `;
    const queryResult = await DBSendResponse(query);
    res.json(queryResult);
    return;
  } else {
    timeSheetList = await getTimeSheetAllList();
  }

  res.json(timeSheetList);
};
exports.addTimeSheet = async function (req, res) {
  addTimeSheet(req, res);
};
exports.updateTimeSheet = async function (req, res) {
  updateOneTimeSheet(req, res);
};
exports.deleteTimeSheet = async function (req, res) {
  delOneTimeSheet(req, res);
};

async function getTimeSheet (req, res) {
  // const EmpQuery = `select * from employee where emp_id = ${req.query.emp_id}`
  // const empobj = await DBSendResponse(EmpQuery)
  try {
    const query = `Select time_sheet_id,company_id,emp_id,time_sheet.pay_period_id,time_sheet_status,submitted_on,approved_on,approved_by,payroll_type,start_date,end_date,pay_date,time_entry_submit_date,time_entry_approval_date 
  from time_sheet,pay_period
                where time_sheet.pay_period_id = pay_period.pay_period_id
                and company_id = ${req.query.company_id}`;
    console.log(query);
    let payrollList = await DBSendResponse(query);
    if (req.query.time_sheet_id) {
      payrollList = payrollList.filter((payroll) => payroll.time_sheet_id === +req.query.time_sheet_id);
    } else if (req.query.emp_id ) {
      let ManEmpQuery = `select * from employee where emp_manager_id = ${req.query.emp_id} and emp_is_active='true'`;
      let empSupList = await DBSendResponse(ManEmpQuery);

      if(req.query.type === 'Admin'){
        payrollList = payrollList;
      }
      if(req.query.type === 'Manager'){
        payrollList = payrollList.filter((payroll) => (!!empSupList.find((emp)=> emp.emp_id === payroll.emp_id) || payroll.emp_id === +req.query.emp_id));
      }
      if (req.query.type === 'Support Coordinator' || req.query.type === 'Fieldworker'){
        payrollList = payrollList.filter((payroll) => payroll.emp_id === +req.query.emp_id);
      }
    
    } else if (req.query.time_sheet_status) {
      payrollList = payrollList.filter((payroll) => payroll.time_sheet_status === req.query.time_sheet_status);
    } else {
      payrollList = payrollList;
    }
    if (!!req.query.lastN && payrollList.length > +req.query.lastN) {
      payrollList = payrollList.slice(Math.max(payrollList.length - +req.query.lastN, 0));
    }

    if(req.query.employee_id){
      payrollList = payrollList.filter((payroll) => payroll.emp_id === +req.query.employee_id);
    }

    if (req.query.pay_period_id) {
      payrollList = payrollList.filter((payroll) => payroll.pay_period_id === +req.query.pay_period_id);
    }

    console.log(payrollList.length);
    return payrollList;
  }catch(e){
    return { code : 500 , message: 'Missing Some Params' };
  }
}

async function getOneTimeSheet(req, res) {
  const query = `SELECT * from time_sheet where time_sheet_id = ${req.query.time_sheet_id}`;
  console.log(query);
  const out = await DBSendResponse(query);
  return out;
}

async function getTimeSheetAllList() {
  const query = 'SELECT * from time_sheet';
  console.log(query);
  const out = await DBSendResponse(query);
  return out;
}

function addTimeSheet(req, res) {
  const query = 'insert into time_sheet' +
			'(company_id,emp_id,pay_period_id,time_sheet_status,submitted_on,approved_on,approved_by) ' +
			'values(' +
			'' + (req.body.company_id ? req.body.company_id : 'NULL') + ',' +
      '' + (req.body.emp_id ? req.body.emp_id : 'NULL') + ',' +
      '' + (req.body.pay_period_id ? req.body.pay_period_id : 'NULL') + ',' +
      '\'' + (req.body.time_sheet_status ? req.body.time_sheet_status : '') + '\',' +
      '' + (req.body.submitted_on ? req.body.submitted_on : 'NULL') + ',' +
      '' + (req.body.approved_on ? req.body.approved_on : 'NULL') + ',' +
      '' + (req.body.approved_by ? req.body.approved_by : 'NULL') + '); SELECT SCOPE_IDENTITY();';
  console.log(query);
  DBinsert(res, query);
}

async function updateOneTimeSheet(req, res) {
  console.log('XXXXXXXXXXXXXXXXXXX');
  console.log(req.body);

  let setClauses = [
    `company_id=${req.body.company_id}`,
    `emp_id=${req.body.emp_id}`,
    `pay_period_id=${req.body.pay_period_id}`,
    `time_sheet_status='${req.body.time_sheet_status}'`,
    req.body.submitted_on ? `submitted_on='${req.body.submitted_on}'` : null,
    req.body.approved_on ? `approved_on='${req.body.approved_on}'` : null,
    req.body.approved_by ? `approved_by=${req.body.approved_by}` : null,
  ].filter(Boolean).join(',\n');

  const query = `UPDATE time_sheet
    SET
    ${setClauses}
    WHERE time_sheet_id = ${req.body.time_sheet_id}`;

  let out;
  try {
    out = await DBUpdate(query);
  } catch (error) {
    out = 0;
  }

  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    if(req.body.time_sheet_status === 'SUBMITTED'){
      let notifPayload = {
        send_id: req.body.emp_id,
        rec_id: req.body.emp_manager?req.body.emp_manager:req.body.emp_id,
        text: 'New Timesheet submitted',
        emp_id: req.body.emp_id,
        // pro_id: req.body.pro_id,
        notif_reason_id: req.body.time_sheet_id,
      };
      let notif = await addNotif({ params: { notif_type: 'timesheet' },body: notifPayload }, res,notifSendId=true);
      console.log(notif);
    }
    res.json({ code: 200, message: 'Update Success' });
  }
}

async function delOneTimeSheet (req, res) {
  /*  
  const query = `delete from time_sheet where time_sheet_id = ${req.body.time_sheet_id}`
  const out = await DBUpdate(query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
  */
}

