const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')

exports.getAllEmp = async function (req, res) {
  const query = `select emp_id as id, 
		CONCAT ( emp_first_name, ' ', emp_last_name) as employee_name, emp_type, emp_is_active,empEmail as userPrincipalName,sec_email as emp_email from employee where emp_is_active='true' AND emp_company_id=${req.query.comp_id}`
  let employeeList = []
  employeeList = await DBinsertSendResponse(query)
  const result = {}
  result.employeeList = employeeList
  const empTypeQuery = `SELECT EntityValue FROM dropdowns where EntityName='empType' and CompanyID=${req.query.comp_id} and (is_Active=${0} or is_Active=${3})`
  result.empType = (await DBinsertSendResponse(empTypeQuery)).map(ele => ele.EntityValue);
  res.json(result)
}

exports.getAllEmpforSupervisor = async function (req, res) {
  console.log(req.query.emp_id)
  const query = `select  
    (select emp_id,emp_first_name, emp_last_name, emp_type from employee where emp_id = pea_emp_id for JSON PATH) as empdetails,
    (select pro_id, pro_title, pro_description, pro_starts_on, pro_ends_on, pro_currency, pro_price, pro_is_active, pro_created_at, pro_updated_at, pro_customer_id, pro_sponsors_id, pro_contact_id, pro_manager_id, DDD_plan_id, DDD_ID, DDD_budget_amt, last_plan_modified_date, first_billing_date, plan_program_name, plan_approval_date, medicaid_approv_date from project where pro_id = pea_pro_id for JSON PATH) as projectdetails
    from 
    (select pro_manager_id,pro_id,pro_title from project where pro_manager_id = ${req.query.emp_id} and pro_com_id = ${req.query.comp_id}) as project 
    inner join
    (select pea_emp_id,pea_pro_id from projectEmployeeAssignment where pea_is_active = 'True') as employee
    on pro_id = pea_pro_id`

  console.log(query)
  let employeeList = []
  employeeList = await DBinsertSendResponse(query)
  employeeList = employeeList.map((empObj) => {
    const newEmpObj = empObj
    newEmpObj.projectdetails = newEmpObj ? JSON.parse(newEmpObj.projectdetails)[0] : JSON.parse(newEmpObj.projectdetails)
    newEmpObj.empdetails = newEmpObj ? JSON.parse(newEmpObj.empdetails)[0] : JSON.parse(newEmpObj.empdetails)

    return newEmpObj
  })
  // let result ={}
  // result.employeeList = employeeList
  // result.empType = ["Admin","Manager","Support Coordinator","Fieldworker"]

  res.json(employeeList)
}

exports.removeBatch = async function (req, res) {
  console.log('here')
  const result = await Promise.all(req.body.empList.map(async (emp) => {
    const query = `UPDATE employee SET emp_is_active='false' WHERE emp_id=${emp}`
    const queryRes = await DBUpdate(query)
    if (queryRes === 0) {
      res.json({ code: 500, message: 'Error in Task Update' })
    }
    return { status: 200, id: emp }
  }))

  console.log(result)
  res.json({ code: 200, message: 'Update Success' })
}

exports.changeDesgBatch = async function (req, res) {
  const result = await Promise.all(req.body.empList.map(async (emp) => {
    const query = `UPDATE employee SET emp_type='${req.body.type}' WHERE emp_id=${emp}`
    const queryRes = await DBUpdate(query)
    if (queryRes === 0) {
      res.json({ code: 500, message: 'Error in Task Update' })
    }
    return { status: 200, id: emp }
  }))
  console.log(result)
  res.json({ code: 200, message: 'Update Success' })
}
