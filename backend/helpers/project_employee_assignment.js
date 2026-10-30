const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { getProjectsForEmployees } = require('../helpers/projects');
const { map } = require('../models/indexSQL.js');

// Return only the customer IDs fully assigned to an employee. The old UI path loaded every
// project together with tasks, contacts, locations and dropdowns just to derive this list.
exports.getCustomerAssignments = async function (req, res) {
  const companyId = Number(req.query.comp_id);
  const employeeId = Number(req.query.emp_id);

  if (!Number.isInteger(companyId) || !Number.isInteger(employeeId)) {
    return res.status(400).json({ message: 'comp_id and emp_id are required' });
  }

  try {
    const request = new db.Request();
    request.input('companyId', db.Int, companyId);
    request.input('employeeId', db.Int, employeeId);
    const result = await request.query(`
      SELECT DISTINCT p.pro_customer_id AS customer_id
      FROM project p
      WHERE p.pro_com_id = @companyId
        AND p.pro_is_active = 1
        AND p.pro_customer_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM project missingProject
          WHERE missingProject.pro_com_id = p.pro_com_id
            AND missingProject.pro_customer_id = p.pro_customer_id
            AND missingProject.pro_is_active = 1
            AND NOT EXISTS (
              SELECT 1 FROM projectEmployeeAssignment pea
              WHERE pea.pea_pro_id = missingProject.pro_id
                AND pea.pea_emp_id = @employeeId
                AND pea.pea_is_active = 1
            )
        )
      ORDER BY p.pro_customer_id
    `);

    return res.status(200).json({
      customerIds: result.recordset.map(row => row.customer_id)
    });
  } catch (error) {
    console.error('Failed to load customer assignments:', error);
    return res.status(500).json({ message: 'Failed to load customer assignments' });
  }
};

// Apply all changes in one database round-trip and one transaction instead of issuing an HTTP
// request (and an existence query) for every project.
exports.updateCustomerAssignments = async function (req, res) {
  const companyId = Number(req.body.comp_id);
  const employeeId = Number(req.body.emp_id);
  const sourceEmployeeId = Number(req.body.source_emp_id);
  const disassociateSource = req.body.disassociateSource === true;
  const removeOtherCustomers = req.body.removeOtherCustomers === true;
  const customerIds = [...new Set((Array.isArray(req.body.customerIds) ? req.body.customerIds : [])
    .map(Number)
    .filter(Number.isInteger))];

  if (!Number.isInteger(companyId) || !Number.isInteger(employeeId)) {
    return res.status(400).json({ message: 'comp_id and emp_id are required' });
  }
  if (disassociateSource && (!Number.isInteger(sourceEmployeeId) || sourceEmployeeId === employeeId)) {
    return res.status(400).json({ message: 'A different source_emp_id is required when disassociating the source employee' });
  }

  try {
    const request = new db.Request();
    request.input('companyId', db.Int, companyId);
    request.input('employeeId', db.Int, employeeId);
    request.input('sourceEmployeeId', db.Int, Number.isInteger(sourceEmployeeId) ? sourceEmployeeId : null);
    request.input('customerIds', db.NVarChar(db.MAX), JSON.stringify(customerIds));
    const removeSql = removeOtherCustomers ? `
      UPDATE pea
      SET pea_is_active = 0,
          pea_associate_to = CURRENT_TIMESTAMP,
          pea_updated_at = CURRENT_TIMESTAMP
      OUTPUT 1 INTO @changes
      FROM projectEmployeeAssignment pea
      INNER JOIN project p ON p.pro_id = pea.pea_pro_id
      WHERE pea.pea_emp_id = @employeeId
        AND pea.pea_is_active = 1
        AND p.pro_com_id = @companyId
        AND p.pro_is_active = 1
        AND NOT EXISTS (SELECT 1 FROM @selectedCustomers sc WHERE sc.customer_id = p.pro_customer_id);` : '';

    const result = await request.query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @changes TABLE (changed bit);
      DECLARE @selectedCustomers TABLE (customer_id int PRIMARY KEY);
      INSERT INTO @selectedCustomers (customer_id)
      SELECT DISTINCT TRY_CONVERT(int, [value])
      FROM OPENJSON(@customerIds)
      WHERE TRY_CONVERT(int, [value]) IS NOT NULL;
      ${removeSql}

      INSERT INTO projectEmployeeAssignment
        (pea_pro_id, pea_emp_id, pea_status, pea_bill_rate, pea_currency, pea_frequency,
         pea_associate_from, pea_associate_to, pea_is_active, pea_created_at)
      OUTPUT 1 INTO @changes
      SELECT p.pro_id, @employeeId, 'Active', NULL, COALESCE(p.pro_currency, 'USD'), '',
             COALESCE(p.pro_starts_on, CONVERT(date, CURRENT_TIMESTAMP)),
             COALESCE(p.pro_ends_on, CONVERT(date, CURRENT_TIMESTAMP)), 1, CURRENT_TIMESTAMP
      FROM project p
      WHERE p.pro_com_id = @companyId
        AND p.pro_is_active = 1
        AND EXISTS (SELECT 1 FROM @selectedCustomers sc WHERE sc.customer_id = p.pro_customer_id)
        AND NOT EXISTS (
          SELECT 1 FROM projectEmployeeAssignment pea
          WHERE pea.pea_pro_id = p.pro_id
            AND pea.pea_emp_id = @employeeId
            AND pea.pea_is_active = 1
        );

      ${disassociateSource ? `
      -- Transfer semantics: do not remove the source until every selected active project
      -- has an active assignment for the target employee.
      UPDATE sourcePea
      SET pea_is_active = 0,
          pea_associate_to = CURRENT_TIMESTAMP,
          pea_updated_at = CURRENT_TIMESTAMP
      OUTPUT 1 INTO @changes
      FROM projectEmployeeAssignment sourcePea
      INNER JOIN project p ON p.pro_id = sourcePea.pea_pro_id
      WHERE sourcePea.pea_emp_id = @sourceEmployeeId
        AND sourcePea.pea_is_active = 1
        AND p.pro_com_id = @companyId
        AND p.pro_is_active = 1
        AND EXISTS (SELECT 1 FROM @selectedCustomers sc WHERE sc.customer_id = p.pro_customer_id)
        AND EXISTS (
          SELECT 1 FROM projectEmployeeAssignment targetPea
          WHERE targetPea.pea_pro_id = p.pro_id
            AND targetPea.pea_emp_id = @employeeId
            AND targetPea.pea_is_active = 1
        );` : ''}

      COMMIT TRANSACTION;
      SELECT COUNT(*) AS updateCount FROM @changes;
    `);

    return res.status(200).json({
      code: 200,
      updateCount: result.recordset[0]?.updateCount || 0,
      message: 'Customer assignments updated successfully'
    });
  } catch (error) {
    console.error('Failed to update customer assignments:', error);
    return res.status(500).json({ message: 'Failed to update customer assignments' });
  }
};
// const {getEmployeesProject} = require("../helpers/employees")

exports.getProjEmpAssn = async function (req, res) {
  // let projectEmpList=[]
  // if (!!req.query.comp_id && !!req.query.project_id){
  // 	projectEmpList = await getProjEmp(req)

  // }
  // else if(!!req.query.comp_id){
  // 	projectEmpList = await getProjEmpByCompanyID(req)

  // }
  // else if(!!req.query.project_id){
  // 	projectEmpList = await getProjEmpByProjectID(req)

  // }
  projectEmpList = await getProjEmp(req, res);
  res.json(projectEmpList);
};

exports.addProjectEmp = async function (req, res) {
  // Check if employee is already assigned to this project
  const checkQuery = `SELECT pea_id FROM projectEmployeeAssignment WHERE pea_pro_id = ${req.body.projId} AND pea_emp_id = ${req.body.empId} AND pea_is_active = 'true'`;
  console.log('Checking existing assignment:', checkQuery);
  const existingAssignment = await DBSendResponse(checkQuery);
  
  if (existingAssignment && existingAssignment.length > 0) {
    return res.json({ code: 409, message: 'Employee is already assigned to this project' });
  }

  const query = `insert into projectEmployeeAssignment (pea_pro_id, pea_emp_id, pea_status, pea_bill_rate, pea_currency, pea_frequency, pea_associate_from, pea_associate_to,pea_is_active,pea_created_at) VALUES (${req.body.projId},${req.body.empId},'${req.body.status}',${req.body.billRate},'${req.body.currency}','${req.body.freq}','${req.body.assFrom}','${req.body.assTo}','true',CURRENT_TIMESTAMP); SELECT SCOPE_IDENTITY()`;
  console.log(query);
  const pea_id = await DBinsertSendID(query);
  if (!pea_id) {
    res.json({ code: 500, message: 'Employee Add to Project Failed' });
  } else {
    res.json({ code: 200, pea_id: pea_id, message: 'Employee Add to Project Success' });
  }
};

// pea
exports.removeProjEmp = async function (req, res) {
  const query = `UPDATE projectEmployeeAssignment SET pea_is_active='false', pea_associate_to=CURRENT_TIMESTAMP, pea_updated_at=CURRENT_TIMESTAMP WHERE pea_id=${req.body.id}`;
  console.log(query);
  const pea_del_res = await DBUpdate(query);
  if (pea_del_res === 0) {
    res.json({ code: 500, message: 'Employee Remove from Project Failed' });
  }
  res.json({ code: 200, message: 'Employee Remove from Project Success' });
};

exports.updateProjectEmp = async function (req, res) {
  const query = `UPDATE projectEmployeeAssignment SET pea_status='${req.body.status}', pea_bill_rate=${req.body.billRate},pea_frequency='${req.body.freq}',pea_associate_from='${req.body.assFrom}',pea_associate_to='${req.body.assTo}',pea_updated_at=CURRENT_TIMESTAMP WHERE pea_id=${req.body.id}`;
  console.log(query);
  const pea_update = await DBUpdate(query);
  if (pea_update === 0) {
    res.json({ code: 200, message: 'Update Failed' });
  }
  res.json({ code: 200, message: 'Update Success' });
};

async function getProjEmp (req, res) {
  const lastN = req.query.lastN;
  let pea_list = [];
  const query = `select pea_pro_id,pea_emp_id, pea_status, pea_bill_rate, pea_frequency, pea_associate_from, pea_associate_to,
		(select pro_id,pro_title,pro_description, pro_starts_on,pro_ends_on,pro_currency,pro_price, 
			pro_is_active, pro_created_at, pro_updated_at, pro_customer_id, pro_manager_id, pro_com_id 
			from project where pro_id = pea_pro_id for JSON PATH ) as project,
		(select * from employee where emp_id = pea_emp_id for JSON PATH ) as employee
		from projectEmployeeAssignment where pea_is_active = 'true'`;
  // // (select emp_id from employee where pea_emp_id = emp_id and pea_is_active=true for JSON PATH) as employee

  console.log(query,req.query);
  pea_list = await DBSendResponse(query);
  console.log(pea_list.length);
  pea_list = pea_list.map((peaObj) => {
    const newpeaObj = { ...peaObj };
    newpeaObj.project = newpeaObj.project ? JSON.parse(newpeaObj.project)[0] : JSON.parse(newpeaObj.project);
    newpeaObj.employee = newpeaObj.employee ? JSON.parse(newpeaObj.employee)[0] : JSON.parse(newpeaObj.employee);

    return newpeaObj;
  });
  if (!!req.query.pro_id && !!req.query.emp_id) {
    pea_list = pea_list.filter((peaObj) => (peaObj.pea_pro_id === +req.query.pro_id && peaObj.pea_emp_id === +req.query.emp_id));
  } else if (req.query.comp_id) {
    if (req.query.pro_id) {
      console.log('what the fuck man',req.query.pro_id);
      pea_list = pea_list.filter((peaObj) => (peaObj.pea_pro_id === +req.query.pro_id));
    } else if (req.query.emp_id) {
      pea_list = pea_list.filter((peaObj) => peaObj.pea_emp_id === +req.query.emp_id);
    } else {
      pea_list = pea_list.filter((obj) => obj.employee.emp_company_id === +req.query.comp_id);
    }
  } else if (!!req.query.emp_id && !!req.query.company_id) {
    await getProjectsForEmployees(req, res);
  } else if (req.query.emp_id) {
    pea_list = pea_list.filter((peaObj) => peaObj.employee.emp_id === +req.query.emp_id).map((PEAemp) => { return PEAemp.project; });
  } else if (req.query.pro_id) {
    pea_list = pea_list.filter((peaObj) => peaObj.pea_pro_id === +req.query.pro_id).map((PEAemp) => { return PEAemp.employee; });
  } else {
    pea_list = pea_list;
  }
  console.log(pea_list.length);

  if (!!lastN && pea_list.length > lastN) {
    pea_list = pea_list.slice(Math.max(pea_list.length - lastN, 0));
  }

  // res.json(pea_list)
	 return pea_list;
}

async function getProjEmpByCompanyID (req) {
  const query = `select * from projectEmployeeAssignment,employee 
				where pea_emp_id = emp_id and 
				emp_company_id = ${req.query.comp_id} and 
				pea_is_active = true`;
  console.log(query);
  const pea_list = await DBinsertSendResponse(query);
  return pea_list;
}

async function getProjEmpByProjectID (req) {
  const query = `select * from projectEmployeeAssignment,employee 
				where pea_emp_id = emp_id and 
				pea_pro_id = ${req.query.project_id} and 
				pea_is_active = true`;
  console.log(query);
  const pea_list = await DBinsertSendResponse(query);
  return pea_list;
}
