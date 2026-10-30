const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')
const {addTimeSheet} = require('./time_sheet')

exports.getPayrollTables = async function (req, res) {
  let payrollList = []

  if (req.query.company_id) {
    payrollList = await getPayroll(req, res)
  } else if (req.query.payroll_id) {
    payrollList = await getOnePayroll(req, res)
  } else {
    payrollList = await getPayrollAllList()
  }

  res.json(payrollList)
}
exports.addPayroll = async function (req, res) {
  addPayroll(req, res)
}
exports.updatePayroll = async function (req, res) {
  updateOnePayroll(req, res)
}
exports.deletePayroll = async function (req, res) {
  delOnePayroll(req, res)
}

async function getPayroll (req, res) {
  const query = `SELECT * FROM payroll WHERE company_id = ${req.query.company_id}`
  console.log(query)
  let payrollList = await DBSendResponse(query)
  if (req.query.payroll_id) {
    payrollList = payrollList.filter((payroll) => payroll.payroll_id === +req.query.payroll_id)
  } else if (req.query.pay_period_id) {
    payrollList = payrollList.filter((payroll) => payroll.pay_period_id === +req.query.pay_period_id)
  } else if (req.query.pay_period_status) {
    payrollList = payrollList.filter((payroll) => payroll.pay_period_status === req.query.pay_period_status)
  } else if (req.query.closed_by) {
    payrollList = payrollList.filter((payroll) => payroll.closed_by === +req.query.closed_by)
  } else {
    payrollList = payrollList
  }
  if (!!req.query.lastN && payrollList.length > +req.query.lastN) {
    payrollList = payrollList.slice(Math.max(payrollList.length - +req.query.lastN, 0))
  }
  return payrollList
}

async function getOnePayroll(req, res) {
  const query = `SELECT * from payroll where payroll_id = ${req.query.payroll_id}`
  console.log(query)
  const out = await DBSendResponse(query)
  return out
}

async function getPayrollAllList() {
  const query = `SELECT * from payroll`
  console.log(query)
  const out = await DBSendResponse(query)
  return out
}

async function addPayroll (req, res) {
  
  // If setting a payroll to CLOSED, must require a non-NULL 'closed_by' value
  if(req.body.pay_period_status == 'CLOSED' && (!req.body.closed_by || req.body.closed_by=='NULL')){
    res.json({ code: 500, message: 'Update failed' })
    return;
  }
  let payrollQ = `select payroll_id,company_id,pay_period_id from payroll where company_id = ${req.body.company_id} and pay_period_id = ${req.body.pay_period_id}` 
  let payrollRes = await DBSendResponse(payrollQ)
  if(payrollRes.length !== 0){
    res.json({ code: 500, message: 'Already Exist.' })
    return;
  }else{
  let employeeQuery = `select emp_id from employee where emp_company_id = ${req.body.company_id}` 
  let employeeList = await DBSendResponse(employeeQuery)
  let timesheetsAdded = Promise.all(employeeList.map( async(allemp)=> {
    // console.log(allemp)
    let resTsDataQ = 'insert into time_sheet' +
			'(company_id,emp_id,pay_period_id,time_sheet_status,submitted_on,approved_on,approved_by) ' +
			'values(' +
			'' + (req.body.company_id ? req.body.company_id : 'NULL') + ',' +
      '' + (allemp.emp_id ? allemp.emp_id : 'NULL') + ',' +
      '' + (req.body.pay_period_id ? req.body.pay_period_id : 'NULL') + ',' +
      "'" + (req.body.time_sheet_status ? req.body.time_sheet_status : 'ACTIVE') + "'," +
      '' + (req.body.submitted_on ? req.body.submitted_on : 'NULL') + ',' +
      '' + (req.body.approved_on ? req.body.approved_on : 'NULL') + ',' +
      '' + (req.body.approved_by ? req.body.approved_by : 'NULL') + '); SELECT SCOPE_IDENTITY();'

      // console.log(resTsDataQ)

    let res = await DBinsertSendID(resTsDataQ)
    return res
  }))
  console.log('Number of Timesheet Records added',timesheetsAdded.length)
  
  const query = 'insert into payroll' +
			'(company_id,pay_period_id,pay_period_status,closed_on,closed_by) ' +
			'values(' +
			'' + (req.body.company_id ? req.body.company_id : 'NULL') + ',' +
      '' + (req.body.pay_period_id ? req.body.pay_period_id : 'NULL') + ',' +
      "'" + (req.body.pay_period_status ? req.body.pay_period_status : 'ACTIVE') + "'," +
      '' + (req.body.closed_on ? req.body.closed_on : 'NULL') + ',' +
			'' + (req.body.closed_by ? req.body.closed_by : 'NULL') + '); SELECT SCOPE_IDENTITY();'
  console.log(query)
  // res.send(query)
  DBinsert(res, query)
  }
}

async function updateOnePayroll (req, res) {
  console.log('XXXXXXXXXXXXXXXXXXX')
  console.log(req.body)

  // If setting a payroll to CLOSED, must require a non-NULL 'closed_by' value
  // if(req.body.pay_period_status == 'CLOSED' && (!req.body.closed_by || req.body.closed_by=='NULL')){
  //   res.json({ code: 500, message: 'Update failed' })
  //   return;
  // }
  let query = ''
  if(req.body.pay_period_status == "CLOSED"){
    query = `UPDATE payroll
				SET 
        company_id='${req.body.company_id}',
        pay_period_id=${req.body.pay_period_id},
        pay_period_status='${req.body.pay_period_status}',
        closed_on=CURRENT_TIMESTAMP,
        closed_by=${req.body.closed_by} 
        WHERE payroll_id = ${req.body.payroll_id}`
  } else{
    query = `UPDATE payroll
				SET 
        company_id='${req.body.company_id}',
        pay_period_id=${req.body.pay_period_id},
        pay_period_status='${req.body.pay_period_status}',
        closed_by=${req.body.closed_by} 
        WHERE payroll_id = ${req.body.payroll_id}`
  }
  
  
  let out
  try {
    out = await DBUpdate(query)
  } catch (error) {
    console.log(error)
    out = 0
  }

  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

async function delOnePayroll (req, res) {
  /*  
  const query = `delete from payroll where payroll_id = ${req.body.payroll_id}`
  const out = await DBUpdate(query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
  */
}

