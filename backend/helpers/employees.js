const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { getEmployeeList } = require('../queries/entityGetQueries');
const nodemailer = require('nodemailer');
const { parseSQLText, generateSQLText } = require('../utils/validation.js');
const moment = require('moment');

const getProgramIdFromReq = (req) => {
  const parsed = parseInt(req.query.program_id, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

// An employee is connected to a program if they're actively assigned to a project
// under that program, or directly associated to the program itself.
const filterEmployeesByProgram = async (employees, programId) => {
  const normalizedProgramId = programId === 'all' ? null : programId;
  if (!normalizedProgramId || !Array.isArray(employees) || employees.length === 0) {
    return employees;
  }

  const employeeIds = employees
    .map((emp) => Number(emp.emp_id ?? emp.id))
    .filter((empId) => Number.isInteger(empId));

  if (employeeIds.length === 0) {
    return [];
  }

  const [viaProjects, viaProgramAssociation] = await Promise.all([
    DBSendResponse(
      `SELECT DISTINCT pea.pea_emp_id AS emp_id
       FROM projectEmployeeAssignment pea
       INNER JOIN project p ON p.pro_id = pea.pea_pro_id
       WHERE p.pro_program_id = ${programId}
         AND pea.pea_is_active = 'true'
         AND pea.pea_emp_id IN (${employeeIds.join(',')})`
    ),
    DBSendResponse(
      `SELECT DISTINCT entity_id AS emp_id
       FROM program_association
       WHERE program_id = ${programId} AND entity_type = 'employee'`
    ),
  ]);

  const allowedIds = new Set([
    ...viaProjects.map((row) => Number(row.emp_id)),
    ...viaProgramAssociation.map((row) => Number(row.emp_id)),
  ]);

  return employees.filter((emp) => allowedIds.has(Number(emp.emp_id ?? emp.id)));
};


exports.getCaregiverCount = async function (req, res) {
  const com_id = parseInt(req.query.com_id);
  if (!com_id) return res.status(400).json({ error: 'com_id required' });
  const query = `SELECT COUNT(*) AS count FROM employee WHERE emp_company_id = ${com_id} AND emp_is_active = 'true' AND emp_is_admin != 'true' AND emp_type != 'Admin'`;
  const result = await DBSendResponse(query);
  res.json({ count: result[0]?.count || 0 });
};

exports.getEmpTables = async function (req, res) {
  let empList = [];

  if (req.query.com_id) {
    empList = await getEmployee(req, res);
  } else if (req.query.comp_id) {
    empList = await getEmployeeList(req.query.comp_id);
    empList = await filterEmployeesByProgram(empList, getProgramIdFromReq(req));
  } else if (req.query.emp_id) {
    console.log(req.query.emp_id, 'ABCD');
    empList = await getEmployeeById(req, res);
  }else {
    empList = await getEmployeeAllList();
    // console.log(empList)
  }
  res.json(empList);
};

exports.getOneEmployee = async function (req, res) {
  getOneEmployee(req, res);
};

exports.addEmployee = async function (req, res) {
  await addEmployee(req,res);
  // try {
    
  //   const user_name = req.query.user_name

  //   const emp_id = await getEmployeeIdByEmail(req.body.emp_email)
  //   if (emp_id === undefined) {
  //     const result = await addEmployee(req, res, user_name)
  //     return result
  //   }
  //   else {
  //     res.json({
  //       code: 500,
  //       message: "Employee already exists"
  //     })
  //   }
  // }
  // catch (err) {
  //   console.log(err)
  // }

};
exports.updateEmployee = async function (req, res) {
  updateOneEmployee(req, res);
};

exports.deleteEmployee = async function (req, res) {
  delOneEmployee(req, res);
};

// async function getEmployeeList(id){
// 	var query = `SELECT * FROM employee WHERE emp_id = ${id}`;
// 	console.log(query)
// 	var out = await DBSendResponse(query);
// 	return out
// }
// exports.getEmployeesProject = async (req,res) =>{
// 	return await getEmployee(req,res)
// }

exports.getAssociatedEmployees = async (req, res) => {
  const employee_id = req.query.employee_id;
  const company_id = req.query.company_id;

  let manager = await DBSendResponse(`SELECT e1.*
        FROM employee e1
        JOIN employee e2 ON e1.emp_id = e2.emp_manager_id
        WHERE e2.emp_id = ${employee_id} order by e1.emp_first_name asc, e1.emp_last_name asc;`);
  if(manager.length > 0){
    manager = manager[0];
  } else {
    manager = null;
  }

  let directlyManaged = await DBSendResponse(`select * from employee where emp_manager_id=${employee_id} order by emp_first_name asc, emp_last_name asc;`);

  let hr_managers = await DBSendResponse(`SELECT h.relationtype,e.*
      FROM employee e
      JOIN hrstructure h ON e.emp_id = h.empid
      WHERE h.relatedto = ${employee_id} order by e.emp_first_name asc, e.emp_last_name asc;`);

  let hr_managed = await DBSendResponse(`SELECT h.relationtype,e.*
      FROM employee e
      JOIN hrstructure h ON e.emp_id = h.relatedto
      WHERE h.empid = ${employee_id} order by e.emp_first_name asc, e.emp_last_name asc;`);
    
  res.status(200).json({
    manager: manager,
    directlyManaged: directlyManaged,
    hr_managers: hr_managers,
    hr_managed: hr_managed
  });
};

exports.getAssociatedEmployeesAPI = async (emp_id) => {
  const employee_id = emp_id;

  let manager = await DBSendResponse(`SELECT e1.*
      FROM employee e1
      JOIN employee e2 ON e1.emp_id = e2.emp_manager_id
      WHERE e2.emp_id = ${employee_id} order by e1.emp_first_name asc, e1.emp_last_name asc;`);
  if(manager.length > 0){
    manager = manager[0];
  } else {
    manager = null;
  }

  let directlyManaged = await DBSendResponse(`select * from employee where emp_manager_id=${employee_id} order by emp_first_name asc, emp_last_name asc;`);

  let hr_managers = await DBSendResponse(`SELECT h.relationtype,e.*
    FROM employee e
    JOIN hrstructure h ON e.emp_id = h.empid
    WHERE h.relatedto = ${employee_id} order by e.emp_first_name asc, e.emp_last_name asc;`);

  let hr_managed = await DBSendResponse(`SELECT h.relationtype,e.*
    FROM employee e
    JOIN hrstructure h ON e.emp_id = h.relatedto
    WHERE h.empid = ${employee_id} order by e.emp_first_name asc, e.emp_last_name asc;`);
  
  return {
    manager: manager,
    directlyManaged: directlyManaged,
    hr_managers: hr_managers,
    hr_managed: hr_managed
  };
};

exports.getHRstructure = async (req, res) => {
  let comp_id = req.query.comp_id;
  let emp_id = req.query.emp_id;

  const query = `SELECT * FROM [dbo].[hrstructure] WHERE empid = ${emp_id} AND companyid = ${comp_id}`;

  let result = await DBSendResponse(query);

  res.json(result);
};

exports.addToHRstructure = async (req, res) => {
  try {
    for (const emp of req.body.empData) {
      const query = `insert into [dbo].[hrstructure] (empid, relationtype, relatedto, companyid) values (${req.body.ID}, '${req.body.type}', ${emp.id}, ${req.body.comp_id}); SELECT SCOPE_IDENTITY();`;
      // console.log(query)
      const relationshipid = await DBinsertSendID(query);
    }
    return res.json({ code: 200, message: 'Inserted Successfully' });
  }
  catch {
    return res.json({ code: 500, message: 'Insert Failed' });
  }
};

exports.updateHRstructure = async (req, res) => {
  try {
    const transaction = new db.Transaction();

    transaction.begin(err => {
      const request = new db.Request(transaction);

      request.query(`DELETE FROM [dbo].[hrstructure] WHERE empid = ${req.body.ID} AND companyid = ${req.body.comp_id} AND relationtype = '${req.body.type}'`, (err, result) => { 
        if(err) {
          console.log(err);
          transaction.rollback(err => {
            res.json({ code: 500, message: 'Update failed' });
          });
        } else if (!req.body.empData?.length) {
          transaction.commit(err => {
            res.json({ code: 200, message: 'Update Success' });
          });
        } else {
          request.query('INSERT INTO [dbo].[hrstructure] (empid, relationtype, relatedto, companyid) VALUES ' +
          req.body.empData.map(emp => `(${req.body.ID}, '${req.body.type}', ${emp.id}, ${req.body.comp_id})`).join(', '), (err, result) => {
            if(err) {
              console.log(err);
              transaction.rollback(err => {
                res.json({ code: 500, message: 'Update failed' });
              });
            } else {
              transaction.commit(err => {
                res.json({ code: 200, message: 'Update Success' });
              });
            }
          });
        }
      });
    });
  }
  catch {
    return res.json({ code: 500, message: 'Update Failed' });
  }
};

exports.getEmpManagerRec = async (req, res) => {
  await getManagedlist(req, res);
};

getManagedlist = async (req, res) => {
  if (req.query.emp_id) {
    const ManEmpQuery = `select * from employee where emp_manager_id = ${req.query.emp_id} and emp_is_active='true' order by emp_first_name asc, emp_last_name asc`;
    let empSupList = await DBSendResponse(ManEmpQuery);
    empSupList = await filterEmployeesByProgram(empSupList, getProgramIdFromReq(req));
    res.json(empSupList);
  } else {
    res.json({ code: 500, message: 'NO RELAVANT ID PROVIDED' });
  }
};

exports.recoverEmployee = async function (req, res) {
  let query = '';
  if(req.query.secondary_email){
    query = `SELECT e.emp_first_name, e.emp_last_name, e.empEmail, e.sec_email, c.com_name FROM employee as e INNER JOIN company as c ON c.com_id = e.emp_company_id
        where e.sec_email = '${req.query.secondary_email}'`;
  } else if(!!req.query.first_name && !!req.query.last_name && !!req.query.company_name){
    query = `SELECT e.emp_first_name, e.emp_last_name, e.empEmail, e.sec_email, c.com_name FROM employee as e INNER JOIN company as c ON c.com_id = e.emp_company_id
        where e.emp_first_name = '${req.query.first_name}'
        AND e.emp_last_name = '${req.query.last_name}'
        AND c.com_name = '${req.query.company_name}'`;
  }
    
  let recoveryList = await DBSendResponse(query);

  if(recoveryList.length !== 0){
    for(let i=0; i<recoveryList.length; i++){
      await sendRecoveryEmail({ emp_first_name: recoveryList[i].emp_first_name, empEmail: recoveryList[i].empEmail, sec_email: recoveryList[i].sec_email });
    }
  }

  res.json({ code: 200, message: 'Account Recovery Email Sent (If Applicable)' });
};

exports.getEmployeeTasks = async (req, res) => {
  const query = `select * from employee_task et join dropdowns on taskTypeID = ddID where et.companyid = ${req.query.comp_id} and employee_id = ${req.query.employee_id}`;
  const resp = await DBSendResponse(query);
  res.json(resp);
};

exports.addToEmployeeTask = async (req, res) => {
  console.log(req.body);
  try {
    for (const emp of req.body.taskData) {
      const query = `insert into employee_task (employee_id, taskTypeID, status, companyid) values (${req.body.employee_id}, ${emp.ddID}, ${req.body.status}, ${req.body.comp_id}); SELECT SCOPE_IDENTITY();`;
      const relationshipid = await DBinsertSendID(query);
    }
    return res.json({ code: 200, message: 'Inserted Successfully' });
  }
  catch {
    return res.json({ code: 500, message: 'Insert Failed' });
  }
};

exports.deleteFromEmployeeTask = async (req, res) => {
  try {
    for (const emp of req.body.taskData) {
      const query = `delete from employee_task where taskTypeID = ${emp.taskTypeID} and employee_id = ${req.body.employee_id} and companyid = ${req.body.comp_id}`;
      const out = await DBUpdate(query);
    }
    return res.json({ code: 500, message: 'Update failed' });
  }
  catch {
    return res.json({ code: 200, message: 'Update Success' });
  }
};

async function sendRecoveryEmail(data){
  var htmlpage =
    `<p>Hello ${data.emp_first_name},</p>
    <br>
    <p>We received a request to send you your credentials used to log into your Fieldworker Account.</p>
    <p>User ID: ${data.empEmail}</p>
    <p>If you didn't make such a request, you can ignore this message.</p>
    <br>
    <p>Regards,</p>
    <p>Fieldworker App</p>`;

  let transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: false,
    auth: {
      user: process.env.SMTP_USERNAME,
      pass: process.env.SMTP_PWD
    }
  });
  let mailOptions = {
    from: process.env.SMTP_USERNAME,
    to: data.sec_email,
    subject: 'Fieldworker Account Recovery',
    text: 'Fieldworker Account Recovery',
    html: htmlpage
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      return console.log(error.message);
    }
    console.log('| INFO | successfully sent recovery email to ' + data.sec_email);
  });
}

async function getOneEmployee(req, res) {
  const query = `SELECT * from employee where emp_is_active='true' and empEmail = '${req.query.email}' and emp_company_id = '${req.query.company_id}'`;
  // var out = []
  console.log(query);
  const out = await DBSendResponse(query);
  console.log(out);
  res.json(out);
}

async function getEmployeeAllList() {
  const query = `SELECT emp_id as id, emp_type,
	CONCAT ( emp_first_name, ' ', emp_last_name) as employee_name from employee where emp_is_active='true' order by emp_first_name asc, emp_last_name asc`;
  // var out = []
  console.log(query);
  const out = await DBSendResponse(query);
  // console.log(out)
  return out;
}

async function getEmployee(req, res) {
  const query = `SELECT * FROM employee WHERE emp_company_id = ${req.query.com_id} order by emp_first_name asc, emp_last_name asc`;
  let empList = await DBSendResponse(query);
  if (req.query.emp_id) {
    empList = empList.filter((emp) => emp.emp_id === +req.query.emp_id && !!emp.emp_is_active);
  } else if (req.query.emp_type) {
    empList = empList.filter((emp) => emp.emp_type === req.query.emp_type && !!emp.emp_is_active);
  } else {
    empList = empList;
  }
  empList = await filterEmployeesByProgram(empList, getProgramIdFromReq(req));
  if (!!req.query.lastN && empList.length > +req.query.lastN) {
    empList = empList.slice(Math.max(empList.length - +req.query.lastN, 0));
  }
  return empList;
}

async function getEmployeeById(req, res) {
  console.log(req.query.emp_id);
  const query = `SELECT * FROM employee WHERE emp_id = ${req.query.emp_id}`;
  let emp = await DBSendResponse(query);
  return emp;

}

exports.getEmployeeById = async (req, res) => {
  return getEmployeeById(req, res);
};

// async function addEmployee(req, res, user_name) {

//   try {
//     let obj = await axios.post('https://fwonboardapp.azurewebsites.net/api/fieldworker/onboard/initaddEmployee', {
//       comp_id: req.body.company_id,
//       company_name: "Fieldworker",
//       user_name: user_name,
//       first_name: req.body.first_name,
//       last_name: req.body.last_name,
//       employee_email: req.body.empEmail,
//     })

//     if (!!obj) {
//       // return {emp_id : obj.data.id}
//       return { '': obj.data }

//     }

//   } catch (e) {
//     console.log(e)
//     return null
//   }

// }

async function getEmployeeIdByEmail(email) {

  const query = `SELECT emp_id FROM employee WHERE sec_email = '${email}'`;
  const result = await DBinsertAndSelectResponse(query);
  return result;

}

function addEmployee (req, res) {
  let fname = (req.body.first_name ?? '').normalize('NFC');
  fname = fname.replace('\'', '\'\'');
  let lname = (req.body.last_name ?? '').normalize('NFC');
  lname = lname.replace('\'', '\'\'');
  const query = `insert into employee
			(emp_first_name,emp_last_name,emp_addr_line1,emp_addr_line2,
			emp_city,emp_state,emp_zip,emp_phone_number,empEmail,emp_join_date,emp_status,
			emp_type,emp_level,emp_doxylink,emp_vacation,emp_personal,emp_is_admin,emp_is_project_manager,
			emp_is_active,emp_created_at,emp_updated_at,
			emp_manager_id,emp_company_id,emp_sos_status)
			values(
			'${fname || ''}', 
			'${lname || ''}',
			'${req.body.address1 ? req.body.address1.normalize('NFC') : ''}',
			'${req.body.address2 ? req.body.address2.normalize('NFC') : ''}',
			'${req.body.city ? req.body.city.normalize('NFC') : ''}',
			'${req.body.state ? req.body.state.normalize('NFC') : ''})',
			'${req.body.zip ? req.body.zip : ''}',
			'${req.body.phoneList ? req.body.phoneList : ''}',
			'${req.body.empEmail ? req.body.empEmail.normalize('NFC') : ''}',
			${req.body.join_date ? '\'' : ''}${!req.body.join_date ? 'CURRENT_TIMESTAMP' : req.body.join_date}${req.body.join_date ? '\',' : ','}
			'${req.body.status ? req.body.status : ''}',
			'${req.body.employee_type ? req.body.employee_type : ''}',
			'${req.body.employee_level ? req.body.employee_level : ''}',
			'${req.body.employee_doxy_link ? req.body.employee_doxy_link : ''}',
			${req.body.vacation_days ? req.body.vacation_days : 'NULL'},
			${req.body.personal_days_off ? req.body.personal_days_off : 'NULL'},
			'false',
			'false',
			'true',
			CURRENT_TIMESTAMP,
			NULL,
			${req.body.manager ? req.body.manager : 'NULL'},
			${req.body.company_id ? req.body.company_id : 'NULL'},${req.body.emp_sos_status ? req.body.emp_sos_status : 0}); SELECT SCOPE_IDENTITY();`;
  console.log(query);
  // console.log('113',req.body.join_date)
  DBinsert(res, query);
}

async function delOneEmployee(req, res) {
  const booleanValue = req.body.bval;
  const id = req.body.id;
  const query = `UPDATE employee SET emp_is_active = 0 WHERE emp_id = ${id}`;
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

async function updateOneEmployee(req, res) {

  if (req.body.sosUpdate) {
    const query = `UPDATE employee SET emp_sos_status = ${req.body.emp_sos_status} WHERE emp_id = ${req.body.emp_id}`;
    let out;
    try {
      out = await DBUpdate(query);
    } catch (error) {
      out = 0;
    }
    if (out === 0) {
      return res.json({ code: 500, message: 'Update failed' });
    } else {
      return res.json({ code: 200, message: 'Update Success' });
    }
  }

  console.log('XXXXXXXXXXXXXXXXXXX');
  console.log(req.body);

  const query = `UPDATE employee 
				SET 
				emp_first_name='${(req.body.first_name ?? '').normalize('NFC')}',
				emp_last_name='${(req.body.last_name ?? '').normalize('NFC')}',
				emp_addr_line1=${req.body.address1?`'${req.body.address1.normalize('NFC')}'`:'NULL'},
				emp_addr_line2=${req.body.address2?`'${req.body.address2.normalize('NFC')}'`:'NULL'},
				emp_city=${req.body.city?`'${req.body.city.normalize('NFC')}'`:'NULL'},
				emp_state=${req.body.address1?`'${req.body.state.toUpperCase().normalize('NFC')}'`:'NULL'},
				emp_zip=${req.body.zip?`'${req.body.zip}'`:'NULL'},
				empEmail=${req.body.email?`'${req.body.email.normalize('NFC')}'`:'NULL'},
				emp_phone_number=${req.body.phoneList?`'${req.body.phoneList}'`:'NULL'},
				emp_join_date=${req.body.join_date?`'${req.body.join_date}'`:'NULL'},
				emp_status=${req.body.status?`'${req.body.status}'`:'NULL'},
        emp_doxylink=${req.body.telemedRoom?`'${req.body.telemedRoom}'`:'NULL'},
				emp_type=${req.body.employee_type?`'${req.body.employee_type}'`:'NULL'},
				emp_level=${req.body.employee_level?`'${req.body.employee_level}'`:'NULL'},
				emp_vacation=${!req.body.vacation_days ? 'NULL' : req.body.vacation_days},
				emp_personal=${!req.body.personal_days_off ? 'NULL' : req.body.personal_days_off},
				emp_updated_at=CURRENT_TIMESTAMP,
        emp_sos_status=${!req.body.emp_sos_status ? 0 : req.body.emp_sos_status},
        sec_email=${req.body.sec_email?`'${req.body.sec_email.normalize('NFC')}'`:'NULL'},			
        ssn=${req.body.ssn?`'${req.body.ssn}'`:'NULL'},	
        dob=${req.body.dob?`'${req.body.dob}'`:'NULL'},
        compensation_type=${req.body.compensation_type?`'${req.body.compensation_type}'`:'NULL'},
        compensation_rate=${req.body.compensation_rate?`'${req.body.compensation_rate}'`:'NULL'},	
        date_of_termination=${req.body.date_of_termination?`'${req.body.date_of_termination}'`:'NULL'},		
        termination_reason=${req.body.termination_reason?`'${req.body.termination_reason}'`:'NULL'},		
        emp_manager_id=${req.body.emp_manager_id ? req.body.emp_manager_id : 'NULL'},
        emp_gender=${req.body.emp_gender?`'${req.body.emp_gender}'`:'NULL'},
        emp_is_active=${req.body.emp_is_active?`'${req.body.emp_is_active}'`:'0'},
				emp_company_id=${req.body.company_id},
        emp_professionalLicenseNumber=${req.body.emp_professionalLicenseNumber?`'${req.body.emp_professionalLicenseNumber}'`:'NULL'},
        emp_stateRegistraionID=${req.body.emp_stateRegistraionID?`'${req.body.emp_stateRegistraionID}'`:'NULL'},
        emp_stateRegistraionType=${req.body.emp_stateRegistraionType?`'${req.body.emp_stateRegistraionType}'`:'NULL'},
        emp_local_id=${req.body.emp_local_id?`'${req.body.emp_local_id}'`:'NULL'},
        emp_timezone=${req.body.emp_timezone ? `'${req.body.emp_timezone}'` : 'NULL'}
				WHERE emp_id = ${req.body.emp_id}`;
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

async function DBinsertAndSelectResponse(query) {
  console.log(query + ' dbinsertandselect');
  const request = new db.Request();
  let res = await request.query(query).then((result) => {
    return result;
  }).catch((err) => {
    console.log(err);
    return null;
  });
  return !res ? null : res.recordset[0];
}

exports.addEmployeeCertification = async (req, res) => {
  try {
    const { 
      employee_id, 
      cert_name, 
      certifying_body, 
      license_number, 
      issue_date, 
      expiration_date, 
      reminder_days_before 
    } = req.body;

    // Validate required fields
    if (!employee_id || !cert_name) {
      return res.status(400).json({
        message: 'employee_id and cert_name are required'
      });
    }

    // Validate employee_id is a number
    if (isNaN(parseInt(employee_id))) {
      return res.status(400).json({
        message: 'employee_id must be a valid number'
      });
    }

    // Validate cert_name length
    if (cert_name.length > 200) {
      return res.status(400).json({
        message: 'cert_name must not exceed 200 characters'
      });
    }

    // Validate optional string field lengths
    if (certifying_body && certifying_body.length > 200) {
      return res.status(400).json({
        message: 'certifying_body must not exceed 200 characters'
      });
    }

    if (license_number && license_number.length > 100) {
      return res.status(400).json({
        message: 'license_number must not exceed 100 characters'
      });
    }

    // Validate dates if provided
    if (issue_date && !moment(issue_date).isValid()) {
      return res.status(400).json({
        message: 'issue_date must be a valid date'
      });
    }

    if (expiration_date && !moment(expiration_date).isValid()) {
      return res.status(400).json({
        message: 'expiration_date must be a valid date'
      });
    }

    // Validate reminder_days_before if provided
    if (reminder_days_before !== undefined && reminder_days_before !== null && isNaN(parseInt(reminder_days_before))) {
      return res.status(400).json({
        message: 'reminder_days_before must be a valid number'
      });
    }

    // Build insert query
    const query = `INSERT INTO employee_certification (
      employee_id,
      cert_name,
      certifying_body,
      license_number,
      issue_date,
      expiration_date,
      reminder_days_before,
      created_at
    ) VALUES (
      ${parseInt(employee_id)},
      '${parseSQLText(cert_name, 200)}',
      ${certifying_body ? `'${parseSQLText(certifying_body, 200)}'` : 'NULL'},
      ${license_number ? `'${parseSQLText(license_number, 100)}'` : 'NULL'},
      ${issue_date && moment(issue_date).isValid() ? `'${moment(issue_date).format('YYYY-MM-DD')}'` : 'NULL'},
      ${expiration_date && moment(expiration_date).isValid() ? `'${moment(expiration_date).format('YYYY-MM-DD')}'` : 'NULL'},
      ${reminder_days_before !== undefined && reminder_days_before !== null ? parseInt(reminder_days_before) : 30},
      SYSUTCDATETIME()
    ); SELECT SCOPE_IDENTITY();`;

    const certification_id = await DBinsertSendID(query);

    if (!certification_id) {
      return res.status(500).json({
        message: 'Failed to add employee certification'
      });
    }

    res.status(200).json({
      message: 'Employee certification added successfully',
      certification_id: certification_id
    });
  } catch (err) {
    console.log('ERROR | addEmployeeCertification failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while adding employee certification'
    });
  }
};

exports.updateEmployeeCertification = async (req, res) => {
  try {
    const { 
      certification_id, 
      employee_id,
      cert_name, 
      certifying_body, 
      license_number, 
      issue_date, 
      expiration_date, 
      reminder_days_before 
    } = req.body;

    // Validate: must have certification_id OR employee_id
    if (!certification_id && !employee_id) {
      return res.status(400).json({
        message: 'certification_id or employee_id is required'
      });
    }

    // Validate IDs are numbers if provided
    if (certification_id && isNaN(parseInt(certification_id))) {
      return res.status(400).json({
        message: 'certification_id must be a valid number'
      });
    }

    if (employee_id && isNaN(parseInt(employee_id))) {
      return res.status(400).json({
        message: 'employee_id must be a valid number'
      });
    }

    // Validate string field lengths if provided
    if (cert_name && cert_name.length > 200) {
      return res.status(400).json({
        message: 'cert_name must not exceed 200 characters'
      });
    }

    if (certifying_body && certifying_body.length > 200) {
      return res.status(400).json({
        message: 'certifying_body must not exceed 200 characters'
      });
    }

    if (license_number && license_number.length > 100) {
      return res.status(400).json({
        message: 'license_number must not exceed 100 characters'
      });
    }

    // Validate dates if provided
    if (issue_date !== undefined && issue_date !== null && !moment(issue_date).isValid()) {
      return res.status(400).json({
        message: 'issue_date must be a valid date'
      });
    }

    if (expiration_date !== undefined && expiration_date !== null && !moment(expiration_date).isValid()) {
      return res.status(400).json({
        message: 'expiration_date must be a valid date'
      });
    }

    // Validate reminder_days_before if provided
    if (reminder_days_before !== undefined && reminder_days_before !== null && isNaN(parseInt(reminder_days_before))) {
      return res.status(400).json({
        message: 'reminder_days_before must be a valid number'
      });
    }

    // Build SET clause for fields to update
    const updates = [];

    if (cert_name !== undefined) {
      updates.push(`cert_name = '${parseSQLText(cert_name, 200)}'`);
    }

    if (certifying_body !== undefined) {
      updates.push(certifying_body ? `certifying_body = '${parseSQLText(certifying_body, 200)}'` : 'certifying_body = NULL');
    }

    if (license_number !== undefined) {
      updates.push(license_number ? `license_number = '${parseSQLText(license_number, 100)}'` : 'license_number = NULL');
    }

    if (issue_date !== undefined) {
      updates.push(issue_date && moment(issue_date).isValid() ? `issue_date = '${moment(issue_date).format('YYYY-MM-DD')}'` : 'issue_date = NULL');
    }

    if (expiration_date !== undefined) {
      updates.push(expiration_date && moment(expiration_date).isValid() ? `expiration_date = '${moment(expiration_date).format('YYYY-MM-DD')}'` : 'expiration_date = NULL');
    }

    if (reminder_days_before !== undefined && reminder_days_before !== null) {
      updates.push(`reminder_days_before = ${parseInt(reminder_days_before)}`);
    }

    updates.push('updated_at = SYSUTCDATETIME()');

    if (updates.length === 1) {
      // Only updated_at, no actual data to update
      return res.status(400).json({
        message: 'No fields provided to update'
      });
    }

    // Build WHERE clause
    const whereClause = certification_id 
      ? `certification_id = ${parseInt(certification_id)}`
      : `employee_id = ${parseInt(employee_id)}`;

    const query = `UPDATE employee_certification 
      SET ${updates.join(', ')} 
      WHERE ${whereClause}`;

    const result = await DBUpdate(query);

    if (result === 0) {
      return res.status(404).json({
        message: 'Employee certification not found'
      });
    }

    res.status(200).json({
      message: 'Employee certification updated successfully'
    });
  } catch (err) {
    console.log('ERROR | updateEmployeeCertification failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while updating employee certification'
    });
  }
};

exports.getEmployeeCertification = async (req, res) => {
  try {
    const { employee_id, certification_id, expiring_within_days } = req.query;

    // Validate: at least one parameter is required
    if (!employee_id && !certification_id && !expiring_within_days) {
      return res.status(400).json({
        message: 'At least one query parameter is required: employee_id, certification_id, or expiring_within_days'
      });
    }

    // Build WHERE clause dynamically based on provided parameters
    const conditions = [];

    if (certification_id) {
      if (isNaN(parseInt(certification_id))) {
        return res.status(400).json({
          message: 'certification_id must be a valid number'
        });
      }
      conditions.push(`certification_id = ${parseInt(certification_id)}`);
    }

    if (employee_id) {
      if (isNaN(parseInt(employee_id))) {
        return res.status(400).json({
          message: 'employee_id must be a valid number'
        });
      }
      conditions.push(`ec.employee_id = ${parseInt(employee_id)}`);
    }

    if (expiring_within_days) {
      if (isNaN(parseInt(expiring_within_days))) {
        return res.status(400).json({
          message: 'expiring_within_days must be a valid number'
        });
      }
      conditions.push(`ec.expiration_date IS NOT NULL AND ec.expiration_date <= DATEADD(day, ${parseInt(expiring_within_days)}, GETDATE())`);
    }

    const whereClause = conditions.join(' AND ');

    // Query with employee details
    const query = `
      SELECT 
        ec.certification_id,
        ec.employee_id,
        ec.cert_name,
        ec.certifying_body,
        ec.license_number,
        ec.issue_date,
        ec.expiration_date,
        ec.reminder_days_before,
        ec.created_at,
        ec.updated_at,
        CONCAT(e.emp_first_name, ' ', e.emp_last_name) as employee_name,
        e.emp_type,
        CASE 
          WHEN ec.expiration_date IS NULL THEN NULL
          WHEN ec.expiration_date < GETDATE() THEN 'Expired'
          WHEN ec.expiration_date <= DATEADD(day, ec.reminder_days_before, GETDATE()) THEN 'Expiring Soon'
          ELSE 'Active'
        END as status
      FROM employee_certification ec
      INNER JOIN employee e ON ec.employee_id = e.emp_id
      WHERE ${whereClause}
      ORDER BY ec.expiration_date ASC, ec.created_at DESC`;

    const certifications = await DBSendResponse(query);

    res.status(200).json({
      message: 'Employee certifications retrieved successfully',
      certifications: certifications || [],
      count: certifications?.length || 0
    });
  } catch (err) {
    console.log('ERROR | getEmployeeCertification failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while retrieving employee certifications'
    });
  }
};

exports.deleteEmployeeCertification = async (req, res) => {
  try {
    const { certification_id, employee_id } = req.body;

    // Validate: must have certification_id OR employee_id
    if (!certification_id && !employee_id) {
      return res.status(400).json({
        message: 'certification_id or employee_id is required'
      });
    }

    // Validate IDs are numbers if provided
    if (certification_id && isNaN(parseInt(certification_id))) {
      return res.status(400).json({
        message: 'certification_id must be a valid number'
      });
    }

    if (employee_id && isNaN(parseInt(employee_id))) {
      return res.status(400).json({
        message: 'employee_id must be a valid number'
      });
    }

    // Build WHERE clause
    const whereClause = certification_id 
      ? `certification_id = ${parseInt(certification_id)}`
      : `employee_id = ${parseInt(employee_id)}`;

    // Hard delete query
    const query = `DELETE FROM employee_certification WHERE ${whereClause}`;

    const result = await DBUpdate(query);

    if (result === 0) {
      return res.status(404).json({
        message: 'Employee certification not found'
      });
    }

    res.status(200).json({
      message: 'Employee certification deleted successfully',
      deleted_count: result
    });
  } catch (err) {
    console.log('ERROR | deleteEmployeeCertification failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while deleting employee certification'
    });
  }
};