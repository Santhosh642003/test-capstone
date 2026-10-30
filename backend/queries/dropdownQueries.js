const db = require('../models/indexSQL.js')

exports.empTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='empType' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.empLevelDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='empLevel' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.empStatusDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='empStatus' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.currencyDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='currency' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.frequencyDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='frequency' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.customerTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='customerType' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.customerStatusDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='customerStatus' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.designationDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='designation' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.contactTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='contactType' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.contactStatusDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='contactStatus' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.statesDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='states' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.enhancedStatesDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='states' and CompanyID=${id} and is_Active=${0}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.locStatusDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='locStatus' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.locTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='locType' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.taskTypeDD = async function (id, employeeType) {
  const query = `SELECT * FROM dropdowns where EntityName='taskType' and CompanyID=${id} and (is_Active=${0} or is_Active=${3}) and (employeeType in ('All', '${!!employeeType ? employeeType : 'All'}') or employeeType IS Null)`
  // console.log(query)
  const dropdownsList = await DBinsertSendResponse(query)
  return dropdownsList
}

exports.fullTaskTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='taskType' and CompanyID=${id} and (is_Active=${0} or is_Active=${3})`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.enhancedtaskTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='taskType' and CompanyID=${id} and is_Active!=${2}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.enhancedModuleDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='modules' and CompanyID=${id} and is_Active=${0}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}


exports.enhancedEmpTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='empType' and CompanyID=${id} and is_Active!=${2}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.enhancedContactTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='contactType' and CompanyID=${id} and is_Active!=${2}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.enhancedEmpStatusDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='empStatus' and CompanyID=${id} and is_Active!=${2}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.enhancedlocTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='locType' and CompanyID=${id} and is_Active!=${2}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.enhancedTypeDD = async function (id,type) {
  const query = `SELECT * FROM dropdowns where EntityName='${type}' and CompanyID=${id} and is_Active!=${2}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

exports.enhancedCustomerTypeDD = async function (id) {
  const query = `SELECT * FROM dropdowns where EntityName='customerType' and CompanyID=${id} and is_Active!=${2}`
  // console.log(query)
  const dropdownsList = await DBResponse(query)
  return dropdownsList
}

async function DBinsertSendResponse (query) {
  const request = new db.Request()
  const res = await request.query(query).then((result) => { return result }).catch((err) => { console.log(err) })
  const ResultList = []
  res.recordset.forEach(function (element) {
    ResultList.push(element.EntityValue)
  })
  return ResultList
}

async function DBResponse (query) {
  const request = new db.Request()
  const res = await request.query(query).then((result) => { return result }).catch((err) => { console.log(err) })
  // const ResultList = []
  // res.recordset.forEach(function (element) {
  //   ResultList.push(element.EntityValue)
  // })
  return res.recordset
}
