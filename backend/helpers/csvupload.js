const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsertSendResponse } = require('../queries/commonQueries')
const csv = require('csvtojson')
const { addOneCustomer, updateCustomer } = require('../helpers/customers')
const Constants = require('../utils/constant')

exports.getCusByDDD = async function (req, res) {
  let custList
  if (!!req.query.comp_id && req.query.ddd_id) {
    custList = await getCustomerByDDD(req.query.ddd_id, req.query.comp_id)
  } else {}
  res.json(custList)
}

exports.getComByname = async function (com_name) {
  let company_id
  if (com_name) {
    company_id = await getCompanyIDByName(com_name)
  } else {}
  res.json(company_id)
}

async function getCompanyIDByName (com_name) {
  const query = `SELECT com_id FROM company where com_name = '${com_name}' and com_is_active = 'True' `
  const result = await DBinsertSendResponse(query)
  return result[0]
}

async function getCustomerByDDD (ddd_id, comp_id) {
  const query = `SELECT cus_id FROM customer where DDDID = '${ddd_id}' and cus_company_id=${comp_id}`
  const result = await DBinsertSendResponse(query)
  return result
}

async function getEmployeeByEmail (emp_email, comp_id) {
  const query = `SELECT emp_id FROM employee where empEmail = '${emp_email}' and emp_company_id=${comp_id}`
  const result = await DBinsertSendResponse(query)
  console.log(result)
  return result
}

async function getProjByDDD (ddd_id, comp_id) {
  const query = `SELECT pro_id FROM project where DDD_ID = '${ddd_id}' and pro_com_id=${comp_id}`
  const result = await DBinsertSendResponse(query)
  console.log(result)
  return result
}

exports.sendData = async function (req, res) {
  /*
    Check if file exist  and in else if check if its with extensnsion csv
    (With not matching condition return response)
    */
  if (!req.file) {
    res.json({ code: 500, message: 'File not present or missed while uploading' })
    return
  } else if (req.file.filename.substr(filename.length - 4, 3).toLowerCase() == 'csv'.toLowerCase()) {
    console.log(req.file.filename.substr(filename.length - 4, 3).toLowerCase())
    res.json({ code: 500, message: 'File is Not a CSV file' })
    return
  }

  // Creating constant/ENUM for making good standard
  console.log(Constants.DDD_ID)

  const jsonArray = await csv().fromString(req.file.buffer.toString('utf8'))

  splitAddr = (add) => {
    const addressList = add.split(', ')
    let addr = {}
    if (addressList.length === 4) {
      const state_zip = addressList[3].split(' ')
      addr = { address_line_1: addressList[0], address_line_2: addressList[1], city: addressList[2], state: state_zip[0], zip: state_zip[1] }
    } else if (addressList.length === 3) {
      const state_zip = addressList[2].split(' ')
      addr = { address_line_1: addressList[0], city: addressList[1], state: state_zip[0], zip: state_zip[1] }
    } else {
      addr = { address_line_1: '', address_line_2: '', city: '', state: '', zip: '' }
    }
    return [addr]
  }

  const resultArr = await Promise.all(jsonArray.map(async (obj) => {
    const addr = splitAddr(obj.Address)
    const company_name = obj['SC Agency']

    // Check if company is registered
    const com_id = await getCompanyIDByName(company_name)
    console.log(com_id.com_id)

    const cust = {
      ddd_id: obj['DDD ID'],
      name: obj.Name,
      waiver_prgm: obj['Waiver Program'],
      sc_agency: obj['SC Agency'],
      address: addr,
      age: obj.Age,
      phone: obj['Contact Phone'],
      dob: obj['Date of Birth'],
      email: obj['E-mail'],
      status: obj.Status,
      county: obj.County,
      func_criteria_met: obj['Functional Criteria Met'],
      gender: obj.Gender,
      last_assess_date: obj['Last Assessment Date'],
      medicaid_eligible: obj['Medicaid Eligibility'],
      medicaid_end_date: obj['Medicaid End Date'],
      medicaid_id: obj['Medicaid ID'],
      company_id: com_id.com_id,
      is_company: 'True'
    }
    const proj = {
      ddd_id: obj['DDD ID'],
      active_plan_allocated: obj['Active Plan Allocated'],
      active_plan_budget: obj['Active Plan Budget'],
      active_plan_extended: obj['Active Plan Expended'],
      active_plan_version: obj['Active Plan Version'],
      curr_plan_allocated: obj['Current Plan Allocated'],
      curr_plan_budget: obj['Current Plan Budget'],
      curr_plan: obj['Current Plan'],
      curr_plan_status: obj['Current Plan Status'],
      curr_plan_version: obj['Current Plan Version'],
      due_date: obj['Due Date'],
      medicaid_prgm_status_code: obj['Medicaid Program Status Code']

    }
    const loc = { address: addr }
    const contact = {
      contact_phone: obj['Contact Phone'],
      sc_agency_phone: obj['SC Agency Phone'],
      sc_email: obj['SC E-mail'],
      last_monthly_contact: obj['Last Monthly Contact']
    }
    const employee = {
      scs_email: obj['SCS (SC Supervisor) email'],
      sc: obj['SC (Support Coordinator)'],
      sc_agency_phone: obj['SC Agency Phone'],
      sc_email: obj['SC E-mail']
    }

    // get cus id based on the ddd_id,
    // if cus_id exists, call update
    // else call insert
    const cusexists = await getCustomerByDDD(obj['DDD ID'], com_id.com_id)
    let loc_id
    if (cusexists.length === 0) {
      var prevBody = req.body
      console.log(prevBody)
      req.body = { ...Object.assign(prevBody, { ...cust }) }
      const cusID = await addOneCustomer(req, res, sendID = true)
      console.log(cusID)
      if (!cusID) {
        res.json({ code: 500, message: 'Insert Failed For Customer' })
      } else {
        loc_id = cusID.loc_id
        console.log(loc_id)
        res.json({ code: 200, message: 'Inserted' })
      }
    } else {
      var prevBody = req.body
      console.log(cusexists)
      req.body = { ...Object.assign(prevBody, { ...cust, ...cusexists[0] }) }
      const cusID = await updateCustomer(req, res, sendID = true)
      if (!cusID) { res.json({ code: 500, message: 'Update Failed For Customer' }) }
    }
  }))
}
