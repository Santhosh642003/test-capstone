const db = require('../models/indexSQL.js')
const moment = require('moment')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')

exports.getPayPeriodTables = async function (req, res) {
  let payPeriodList = []

  if (req.query.pay_period_id || req.query.payroll_type) {
    payPeriodList = await getPayPeriod(req, res)
  } else {
    payPeriodList = await getPayPeriodAllList()
  }

  res.json(payPeriodList)
}
exports.addPayPeriod = async function (req, res) {
  addPayPeriod(req, res)
}
exports.updatePayPeriod = async function (req, res) {
  updateOnePayPeriod(req, res)
}
exports.deletePayPeriod = async function (req, res) {
  delOnePayPeriod(req, res)
}

async function getPayPeriod (req, res) {
  let query = ``
  if(req.query.pay_period_id){
    query = `SELECT * FROM pay_period WHERE pay_period_id = ${req.query.pay_period_id}`
  } else {
    query = `SELECT * FROM pay_period WHERE payroll_type = '${req.query.payroll_type}'`
  }
  let payPeriodList = await DBSendResponse(query)
  if (req.query.pay_period_id) {
    payPeriodList = payPeriodList.filter((pay_period) => pay_period.pay_period_id === +req.query.pay_period_id)
  } else if (req.query.payroll_type) {
    payPeriodList = payPeriodList.filter((pay_period) => pay_period.payroll_type === req.query.payroll_type)
  } else if (req.query.payroll_number) {
    payPeriodList = payPeriodList.filter((pay_period) => pay_period.payroll_number === +req.query.payroll_number)
  } else if (req.query.pay_of_the_month) {
    payPeriodList = payPeriodList.filter((pay_period) => pay_period.pay_of_the_month === +req.query.pay_of_the_month)
  } else {
    payPeriodList = payPeriodList
  }

  if(!!req.query.payroll_day){
    payPeriodList = payPeriodList.map((pay,i)=> {
        let divideFactor = req.query.payroll_type === 'WEEK'?1:req.query.payroll_type === 'BIWEEK'?2:req.query.payroll_type === 'SEMIMONTH'?3:4

        if(divideFactor === 1 || divideFactor === 2){
          if( 
          (i%divideFactor === 0 || i===0) 
          && moment(pay.start_date).format('ddd') === req.query.payroll_day
          )
          {
            return pay
          }else{
            return null
          }
        
        }else{
            return pay
        }


      }).filter((period)=> !!period)
  }
  if (!!req.query.lastN && payPeriodList.length > +req.query.lastN) {
    payPeriodList = payPeriodList.slice(Math.max(payPeriodList.length - +req.query.lastN, 0))
  }
  return payPeriodList
}

function addPayPeriod (req, res) {
  const query = 'insert into pay_period' +
			'(payroll_type,payroll_number,pay_of_the_month,start_date,end_date,pay_date,time_entry_submit_date,time_entry_approval_date) ' +
			'values(' +
			"'" + (req.body.payroll_type ? req.body.payroll_type : 'NULL') + "'," +
			'' + (req.body.payroll_number ? req.body.payroll_number : 'NULL') + ',' +
			'' + (req.body.pay_of_the_month ? req.body.pay_of_the_month : 'NULL') + ',' +
			"'" + (req.body.start_date ? req.body.start_date : 'NULL') + "'," +
			"'" + (req.body.end_date ? req.body.end_date : 'NULL') + "'," +
			"'" + (req.body.pay_date ? req.body.pay_date : 'NULL') + "'," +
			"'" + (req.body.time_entry_submit_date ? req.body.time_entry_submit_date : 'NULL') + "'," +
			"'" + (req.body.time_entry_approval_date ? req.body.time_entry_approval_date : 'NULL') + "'); SELECT SCOPE_IDENTITY();"
  console.log(query)
  DBinsert(res, query)
}

async function updateOnePayPeriod (req, res) {
  console.log('XXXXXXXXXXXXXXXXXXX')
  console.log(req.body)

  const query = `UPDATE pay_period 
				SET 
        payroll_type='${req.body.payroll_type}',
        payroll_number=${req.body.payroll_number},
        pay_of_the_month=${req.body.pay_of_the_month},
        start_date='${req.body.start_date}',
        end_date='${req.body.end_date}',
        pay_date='${req.body.pay_date}',
        time_entry_submit_date='${req.body.time_entry_submit_date}',
        time_entry_approval_date='${req.body.time_entry_approval_date}'
        WHERE pay_period_id = ${req.body.pay_period_id}`
  let out
  try {
    out = await DBUpdate(query)
  } catch (error) {
    out = 0
  }

  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

async function delOnePayPeriod (req, res) {
  /*
  const booleanValue = req.body.bval
  const id = req.body.id
  const query = `UPDATE employee SET emp_is_active = '${booleanValue}' WHERE emp_id = ${id}`
  const out = await DBUpdate(query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
  */
}
