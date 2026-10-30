const db = require('../models/indexSQL.js');
const {
  DBinsertSendID,
  DBinsert,
  DBUpdate,
  DBSendResponse,
  DBinsertSendResponse,
} = require('../queries/commonQueries');
const {
  getLocationList,
  getEmployeeList,
  getTaskList,
  getProjectList,
} = require('../queries/entityGetQueries');
const {
  empLevelDD,
  empTypeDD,
  empStatusDD,
  currencyDD,
  frequencyDD,
  customerTypeDD,
  customerStatusDD,
  designationDD,
  contactStatusDD,
  contactTypeDD,
  statesDD,
  locStatusDD,
  locTypeDD,
  taskTypeDD,
} = require('../queries/dropdownQueries');
const { addProject } = require('../queries/dependantQueries');
const moment = require('moment');
const { getCustomersAssociatedAPI } = require('./customers.js');
const { parseSQLText, generateSQLText } = require('../utils/validation.js');

const getProgramIdFromReq = (req) => {
  const parsed = parseInt(req.query.program_id, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const getProgramFilterClause = (programId) => {
  if (!programId) {
    return '';
  }
  return ` AND pro_program_id=${programId}`;
};

exports.getProject = async function (req, res) {
  const start = performance.now();
  try {
    await getProject(req,res);
    console.log(`/api/fieldworker/project GET TIMETAKEN: ${performance.now() - start} MS`);
  } catch (error) {
    console.log(`/api/fieldworker/project GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/project GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

async function getProject (req, res) {
  if (!!req.query.comp_id && !req.query.proj_id && !req.query.emp_id) {
    await getAllProjects(req, res);
  } else if (!!req.query.comp_id && !!req.query.proj_id) {
    await getOneProject(req, res);
  } else if (!!req.query.comp_id && !!req.query.emp_id) {
    await getEmpProjects(req, res);
  } else if (req.query.company_id) {
    await getallProjects(req, res);
  } else if (req.query.cus_id) {
    await getProjectsByCustomer(req, res);
  } else {
    // res.json({code:301 ,message: 'You are missing Params'})
    await getProjectlist(req, res);
  }
};

async function getProjectsByCustomer(req, res) {
  const programId = getProgramIdFromReq(req);
  const query = `select * from project where pro_customer_id=${req.query.cus_id}${getProgramFilterClause(programId)}`;
  const response = await DBSendResponse(query);
  res.json(response);
}

exports.getProjectListDDDID = async function (req, res) {
  const query = `select pro_id,DDD_ID,active_plan_version from project
	where pro_com_id=${req.query.com_id} and pro_customer_id = ${req.query.cus_id} and DDD_ID = '${req.query.ddd_id}' and active_plan_version = '${req.query.version}';`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  const projList = ResultList.map((projItem) => {
    return projItem;
  });

  res.json(projList);
};

// async function getSingleProject()

// Minimize the payload and merge
async function getAllProjects(req, res) {
  const id = req.query.comp_id;
  const programId = getProgramIdFromReq(req);
  const query =
    'select *,' +
    '(select * from customer where cus_id=pro_customer_id for JSON PATH) as customer_details,' +
    '(select * ' +
    'from location,projectLocation where loc_id=ploc_loc_id and ploc_pro_id=pro_id for JSON PATH) as locations,' +
    '(select * from projectEmployeeAssignment,employee where pea_pro_id=pro_id and emp_id=pea_emp_id and pea_is_active=\'true\' for JSON PATH) as employees,' +
    '(select * from task where tas_pro_id=pro_id for JSON PATH) as tasks,' +
    '(select * from ProjectContact,contact where pro_id=proj_id AND con_id=cont_id for JSON PATH) as contacts,' +
    '(Select * from contact WHERE (pro_customer_id=con_customer_id OR con_customer_id IS NULL) AND con_company_id=' +
    id +
    ' for JSON PATH) as rel_contacts' +
    ' from' +
    ' project ' +
    'where pro_com_id=' +
    id +
    getProgramFilterClause(programId);
  const data = {
    dropdownValues: {
      location_list: await getLocationList(id),
      employee_list: await getEmployeeList(id),
      task_list: await getTaskList(id),
      empType: await empTypeDD(id),
      empLevel: await empLevelDD(id),
      empStatus: await empStatusDD(id),
      currency: await currencyDD(id),
      frequency: await frequencyDD(id),
      customerType: await customerTypeDD(id),
      customerStatus: await customerStatusDD(id),
      taskType: await taskTypeDD(id),
      designation: await designationDD(id),
      contactType: await contactTypeDD(id),
      contactStatus: await contactStatusDD(id),
      states: await statesDD(id),
      locStatus: await locStatusDD(id),
      locType: await locTypeDD(id),
    },
    projects: [],
  };
  const request = new db.Request();
  request
    .query(query)
    .then((result) => {
      result.recordsets[0].forEach((proj) => {
        const projDets = proj;
        projDets.customer_details = JSON.parse(proj.customer_details);
        projDets.locations = JSON.parse(proj.locations);
        projDets.employees = JSON.parse(proj.employees);
        projDets.tasks = JSON.parse(proj.tasks);
        projDets.contacts = JSON.parse(proj.contacts);
        projDets.rel_contacts = JSON.parse(proj.rel_contacts);
        data.projects.push(projDets);
      });

      res.json(data);
    })
    .catch((err) => {
      res.json(err);
    });
}

exports.getProjectsForEmployees = async (req, res) => {
  await getallProjects(req, res);
};

async function getallProjects(req, res) {
  const id = req.query.company_id;
  const programId = getProgramIdFromReq(req);
  const query =
    'select *,' +
    '(select cus_id, cus_name from customer where cus_id=pro_customer_id for JSON PATH) as customer_details,' +
    '(select loc_id,loc_addr_line1,loc_addr_line2,loc_city,loc_state,loc_zip,loc_lat,loc_lon,loc_type,loc_status,loc_county,loc_association_date,loc_phone_number,loc_company_id,loc_is_active ' +
    'from location,projectLocation where loc_id=ploc_loc_id and ploc_pro_id=pro_id for JSON PATH) as locations,' +
    '(select emp_id from projectEmployeeAssignment,employee where pea_pro_id=pro_id and emp_id=pea_emp_id and pea_is_active=\'true\' for JSON PATH) as employees' +
    ' from' +
    ' project ' +
    'where pro_com_id=' +
    id +
    getProgramFilterClause(programId);
  const projData = await DBSendResponse(query);
  let projArr;
  projArr = projData.map((proj) => {
    const projDets = proj;
    projDets.customer_details = JSON.parse(proj.customer_details);
    projDets.locations = JSON.parse(proj.locations);
    projDets.employees = JSON.parse(proj.employees);
    // projDets.tasks = JSON.parse(proj.tasks)
    // projDets.contacts = JSON.parse(proj.contacts)
    // projDets.rel_contacts = JSON.parse(proj.rel_contacts)
    return projDets;
  });
  if (req.query.emp_id) {
    projArr = projArr.filter(
      (proj) => !!proj.employees.find((emp) => emp.emp_id === +req.query.emp_id)
    );
  } else if (req.query.cust_id) {
    projArr = projArr.filter(
      (proj) => proj.pro_customer_id === +req.query.cust_id
    );
  } else if (req.query.con_id) {
    projArr = projArr.filter(
      (proj) => !!proj.contacts.find((con) => con.con_id === +req.query.con_id)
    );
  } else {
    projArr = projArr;
  }
  if (!!req.query.lastN && projArr.length > +req.query.lastN) {
    projArr = projArr.slice(Math.max(projArr.length - +req.query.lastN, 0));
  }
  if (!!req.query.pageSize && !!req.query.pageNum) {
    let pageSize = +req.query.pageSize;
    let pageNum = +req.query.pageNum;
    projArr = projArr.slice(
      (pageNum - 1) * pageSize,
      (pageNum - 1) * pageSize + pageSize
    );
  }
  res.json(projArr);
}

// Merge
async function getProjectlist(req, res) {
  const projList = await getProjectList(req.query.com_id);
  res.json(projList);
}

const toFloatSql = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return 'NULL';
  const n = Number(value);
  return Number.isFinite(n) ? n : 'NULL';
};

exports.addOneProject = async function (req, res) {
  addProject(req, res, (sendId = false));
};

exports.addOneProjectwithDefaults = async function (req, res) {
  const project = await addProject(req, res, (sendId = true));
  req.log.debug('Project post: ' + project);
  if (project) {
    res.json({ code: 200, id: project, message: 'Inserted successfully' });
  } else {
    res.json({ code: 500, message: 'Insert failed' });
  }
};

exports.patchProject = async function (req, res) {
  const query = `UPDATE project SET
	 		DDD_ID='${req.body.ddd_id}',
			pro_price=${req.body.pPrice || 0},
			last_plan_modified_date=CURRENT_TIMESTAMP,
			active_plan_allocated=${req.body.active_plan_allocated || 0},
			active_plan_budget=${req.body.active_plan_budge || 0},
			active_plan_expended=${req.body.active_plan_expended || 0},
			active_plan_version='${req.body.active_plan_version || 0}',
			curr_plan_allocated=${req.body.curr_plan_allocated || 0},
			curr_plan_budget=${req.body.curr_plan_budget || 0},
			curr_plan=${req.body.curr_plan || 0},
			curr_plan_version=${req.body.curr_plan_version || 0},
			medicaid_prgm_status_code=${req.body.medicaid_prgm_status_code
    ? '\'' + req.body.medicaid_prgm_status_code + '\''
    : 'NULL'
}
				WHERE pro_id = ${req.body.pro_id} and pro_com_id = ${req.body.company_id};`;
  const out = await DBUpdate(query);

  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, id: out, message: 'Update Success' });
  }
};

exports.updateProj = async function (req, res) {
  // Find All Locations Related Projects
  const getAllProjLocQuery = `Select * from projectLocation where ploc_pro_id = ${req.body.projId}`;
  const pLocResult = await DBSendResponse(getAllProjLocQuery);
  let prevLocId = pLocResult;
  req.body.pLoc.forEach((loc) => {
    prevLocId = prevLocId.filter((pLoc) => pLoc.ploc_loc_id !== loc.locId);
  });

  const delRes = await Promise.all(
    prevLocId.map(async (pLoc) => {
      const delQuery = `DELETE from projectLocation WHERE ploc_id=${pLoc.ploc_id}`;
      const res = await DBUpdate(delQuery);
      if (res === 0) {
        res.json({ code: 500, message: 'Update failed' });
      }
      return { status: 200, id: pLoc.ploc_id, action: 'DELETED' };
    })
  );

  let currPloc = req.body.pLoc;
  pLocResult.forEach((loc) => {
    currPloc = currPloc.filter((currloc) => currloc.locId !== loc.ploc_loc_id);
  });
  const addRes = await Promise.all(
    currPloc.map(async (addLoc) => {
      const addQuery = `insert into projectLocation(ploc_pro_id,ploc_loc_id) values(${req.body.projId},${addLoc.locId}); SELECT SCOPE_IDENTITY();`;
      const res = await DBUpdate(addQuery);
      if (res === 0) {
        res.json({ code: 500, message: 'Update failed' });
      }
      return { status: 200, id: addLoc.locId, action: 'ADDED' };
    })
  );

  const hasProgramId = Object.prototype.hasOwnProperty.call(req.body, 'pro_program_id');
  const programId = Number(req.body.pro_program_id);
  const programIdSql = Number.isInteger(programId) && programId > 0 ? programId : 'NULL';
  const programUpdateSql = hasProgramId ? `pro_program_id=${programIdSql},` : '';

  const hasCurrPlanVersion = Object.prototype.hasOwnProperty.call(req.body, 'curr_plan_version');
  const currPlanVersionSql = toFloatSql(req.body.curr_plan_version);
  const currPlanVersionUpdateSql = hasCurrPlanVersion ? `curr_plan_version=${currPlanVersionSql},` : '';

  const query = `UPDATE project 
				SET 
					pro_title='${generateSQLText(req.body.pTitle, 100, null)}',
					DDD_ID=${generateSQLText(req.body.ddd_id, 10, null)},
					active_plan_version=${generateSQLText(req.body.active_plan_version, 20, 0)},
					pro_description='${generateSQLText(req.body.pDesc, 250, null)}',
					pro_ends_on='${req.body.pEndDate}',
					pro_price='${req.body.pPrice}',
					pro_updated_at=CURRENT_TIMESTAMP,
          pro_updated_by=${req.body.user_id || 'NULL'},
					pro_sponsors_id=${req.body.pSponsor},
					pro_manager_id=${req.body.pManager},
					pro_com_id=${req.body.company_id},
          LastAnnualVisitDate=${req.body.LastAnnualVisitDate ? `'${req.body.LastAnnualVisitDate}'` : 'NULL'},
          pro_self_pay='${req.body?.pro_self_pay}',
          pro_primary_payer=${req.body.pro_primary_payer ? req.body.pro_primary_payer : 'NULL'},
          pro_secondary_payer=${req.body.pro_secondary_payer ? req.body.pro_secondary_payer : 'NULL'},
          ${programUpdateSql}
          ${currPlanVersionUpdateSql}
          place01char=${req.body.place01char ? `'${req.body.place01char}'` : 'NULL'},
          place02char=${req.body.place02char ? `'${req.body.place02char}'` : 'NULL'},
          place03char=${req.body.place03char ? `'${req.body.place03char}'` : 'NULL'},
          place04date=${req.body.place04date ? `'${req.body.place04date}'` : 'NULL'},
          place05date=${req.body.place05date ? `'${req.body.place05date}'` : 'NULL'},
          place06number=${req.body.place06number ? req.body.place06number : 'NULL'},
          place07number=${req.body.place07number ? req.body.place07number : 'NULL'}
				WHERE pro_id = ${req.body.projId}`;
  console.log('Project update query:', query);
  const out = await DBUpdate(query);

  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
};

exports.patchProj = async (req, res) => {
  let query = `SELECT * FROM project WHERE pro_id = ${req.body.pro_id}`;
  let projectToPatch = await DBSendResponse(query);

  if (projectToPatch.length === 0) {
    res.json({ code: 500, message: 'Project not found' });
  } else {
    query = 'UPDATE project SET ';
    let changes = req.body;
    let keys = Object.keys(changes);
    keys.forEach((key) => {
      if (key !== 'pro_id') {
        query += `${key} = '${changes[key]}',`;
      }
    });
    query = query.slice(0, -1);
    query += ` WHERE pro_id = ${req.body.pro_id}`;

    let result = await DBUpdate(query);

    if (result === 0) {
      res.json({ code: 500, message: 'Update failed' });
    }
    else {
      res.json({ code: 200, message: 'Update Success' });
    }
  }
};

// Merge
async function getOneProject(req, res) {
  const id = req.query.comp_id;
  const pid = req.query.proj_id;
  const programId = getProgramIdFromReq(req);
  let ts = Date.now();
  let date_ob = new Date(ts);
  let date = date_ob.getDate();
  let month = date_ob.getMonth() + 1;
  let year = date_ob.getFullYear();
  let currentDate = +year + '-' + month + '-' + date + 'T00:00:00.0000000';

  const query =
    'select *,' +
    '(select * from customer where cus_id=pro_customer_id for JSON PATH) as customer_details,' +
    '(select * ' +
    'from location,projectLocation where loc_id=ploc_loc_id and ploc_pro_id=pro_id for JSON PATH) as locations,' +
    '(select * from projectEmployeeAssignment,employee where pea_pro_id=pro_id and emp_id=pea_emp_id and pea_is_active=\'true\'and pea_associate_from<=\'' +
    currentDate +
    '\' for JSON PATH) as employees,' +
    '(select t.*, m.*, e.checkoutEmpDate, e.empLocdate from task t left join monthlymonitoring m on t.tas_mm_id=m.monthly_monitoring_id left join empLocate e on t.tas_id=e.taskId where t.tas_pro_id=pro_id for JSON PATH) as tasks,' +
    '(select * from ProjectContact,contact where pro_id=proj_id AND con_id=cont_id for JSON PATH) as contacts,' +
    '(Select * from contact WHERE (pro_customer_id=con_customer_id OR con_customer_id IS NULL) AND con_company_id=2004 for JSON PATH) as rel_contacts' +
    ' from' +
    ' project ' +
    'where pro_id=' +
    pid +
    ' and pro_com_id=' +
    id +
    getProgramFilterClause(programId);
  const projectList = await DBSendResponse(query);
  projectList[0].customer_details = JSON.parse(projectList[0].customer_details);
  projectList[0].locations = JSON.parse(projectList[0].locations);
  projectList[0].employees = JSON.parse(projectList[0].employees);
  projectList[0].tasks = JSON.parse(projectList[0].tasks);
  projectList[0].contacts = JSON.parse(projectList[0].contacts);
  projectList[0].rel_contacts = JSON.parse(projectList[0].rel_contacts);
  res.json(projectList[0]);
}

exports.getAProject = async function (req, res) {
  let id = req.query.company_id || req.query.comp_id || req.query.com_id;
  let emp = +req.query.emp_id;
  let type = req.query.type;
  const programId = getProgramIdFromReq(req);
  try {
    let query = `select *,
        (select * from customer where cus_id = pro_customer_id for JSON PATH) as customer_details,
        (select * from location, projectLocation where loc_id = ploc_loc_id and ploc_pro_id = pro_id for JSON PATH) as locations,
        (select * from projectEmployeeAssignment, employee where pea_pro_id = pro_id and emp_id = pea_emp_id and pea_is_active = 'true' for JSON PATH) as employees
      from project 
      where pro_com_id = ${id}${programId ? ` and pro_program_id = ${programId}` : ''}`;
    if (req.query.queryType === '1') {
      query += ' ORDER BY pro_ends_on desc OFFSET 25 ROWS';
    } else if (req.query.queryType === '0') {
      query += ' ORDER BY pro_ends_on desc OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY';
    } else {

    }

    let projectList = await DBSendResponse(query);

    projectList.forEach((project) => {
      project.customer_details = JSON.parse(project.customer_details);
      project.locations = JSON.parse(project.locations);
      project.employees = JSON.parse(project.employees);
    });

    if (!!emp && !isNaN(emp)) {
      if (type === 'Fieldworker') {
        projectList = projectList.filter(
          (res) =>
            !!res.employees && res.employees.some((empL) => empL.emp_id === emp)
        );
      } else {
        projectList = projectList.filter(
          (res) =>
            !!res.employees &&
            res.employees.some(
              (empL) => empL.emp_id === emp || empL.emp_manager_id === emp
            )
        );
      }
    }

    res.json(projectList);
  } catch (e) {
    console.log(e);
    res.json({ message: 'No data. Please pass valid arguments' });
  }
};

// Change query , Minimize the payload and merge
async function getEmpProjects(req, res) {
  const programId = getProgramIdFromReq(req);
  const query =
    'select *,' +
    '(select * from customer where cus_id=pro_customer_id for JSON PATH) as customer_details,' +
    '(select * from location,projectLocation where loc_id=ploc_loc_id and ploc_pro_id=pro_id for JSON PATH) as locations,' +
    '(select emp_id,emp_first_name,emp_last_name,emp_is_active from projectEmployeeAssignment,employee where pea_pro_id=pro_id and emp_id=pea_emp_id and pea_is_active=\'true\' for JSON PATH) as employees,' +
    '(select * from task where tas_pro_id=pro_id AND tas_emp_id=' +
    req.query.emp_id +
    ' for JSON PATH) as tasks ' +
    'from ' +
    'project ' +
    'where pro_com_id=' +
    req.query.comp_id +
    getProgramFilterClause(programId);
  // (emp_id=pea_pro_id or emp_id = pro_manager_id)
  const data = await DBSendResponse(query);
  const dataToSend = data
    .map((proj) => {
      const projDets = proj;
      projDets.customer_details = JSON.parse(proj.customer_details);
      projDets.locations = JSON.parse(proj.locations);
      projDets.employees = JSON.parse(proj.employees);
      projDets.tasks = JSON.parse(proj.tasks);
      if (
        !!projDets.employees &&
        !!projDets.employees.find((emp) => emp.emp_id === +req.query.emp_id)
      ) {
        return projDets;
      } else {
        return null;
      }
    })
    .filter((proj) => !!proj);
  res.json(dataToSend);
}

// Shift inside Task Helpers
exports.getTodaysTasks = function (req, res) {
  const query =
    'Select *,' +
    '(select emp_id,emp_first_name,emp_last_name,emp_is_active from projectEmployeeAssignment,employee where pea_pro_id=pro_id and (emp_id=pea_emp_id or emp_id = pro_manager_id) for JSON PATH) as employeeDets, ' +
    '(select cus_id,cus_name,cus_phone,cus_is_company,cus_is_active from customer where pro_customer_id=cus_id for JSON PATH) as customerDets, ' +
    '(select id, sig_pad, customer_id from signatures where task_id=tas_id for JSON PATH) as signatureDets from task,project,location where tas_pro_id = pro_id AND tas_loc_id = loc_id AND tas_emp_id = ' +
    req.query.emp_id;

  const data = [];
  const request = new db.Request();
  request
    .query(query)
    .then((result) => {
      result.recordsets[0].forEach((proj) => {
        const projDets = proj;
        projDets.employeeDets = JSON.parse(proj.employeeDets);
        projDets.customerDets = JSON.parse(proj.customerDets);
        projDets.signatureDets = JSON.parse(proj.signatureDets);
        data.push(projDets);
      });
      res.json(data);
    })
    .catch((err) => {
      res.json(err);
    });
};

// shoud not be needed
exports.updateTaskStatus = async function (req, res) {
  const statusValue = req.body.statusValue;
  const taskId = req.body.taskId;
  const query = `UPDATE task SET tas_is_active = ${statusValue} WHERE tas_id = ${taskId}`;
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
};

exports.delProj = async function (req, res) {
  const booleanValue = req.body.bval;
  const id = req.body.id;
  const query = `UPDATE project SET pro_is_active = '${booleanValue}' WHERE pro_id = ${id}`;
  const out = await DBUpdate(res, query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
};

exports.getProjContact = async function (req, res) {
  const pid = parseInt(req.query.proj_id, 10);
  if (isNaN(pid)) {
    return res.json([]);
  }

  let query = `select * from ProjectContact, contact where proj_id = ${pid} and cont_id = con_id and con_is_active = 'True'`;

  let projContList = await DBSendResponse(query);

  res.json(projContList);
};

exports.getProjTask = async function (req, res) {
  const pid = req.query.proj_id;

  let query = `select t.*, m.*, e.checkoutEmpDate, e.empLocdate, e.checkoutLocId,
  (select cf.*, f.form_name, f.json_schema, f.translated_json_schema from customer_form cf inner join fw_forms f on cf.form_type = f.form_id where cf.task_id=t.tas_id for JSON PATH) as customerForm
  from task t 
  left join monthlymonitoring m on m.monthly_monitoring_id = t.tas_mm_id
  left join empLocate e on e.taskId = t.tas_id
  where t.tas_pro_id=${pid}`;

  let projTaskList = await DBSendResponse(query, 'debug');
  
  projTaskList = projTaskList.map((task) => {
    task.customerForm = JSON.parse(task.customerForm);
    return task;
  });

  res.json(projTaskList);
};

exports.getProjectCount = async function (req, res) {
  const query = `select * from project where pro_com_id=${req.query.company_id} and pro_is_active='true'`;
  const projectCount = await DBSendResponse(query);
  res.json(projectCount);
};

exports.getIntakeForm = async function (req, res) {
  const query = `select * from project where pro_title='Intake Form' and pro_description='Default Project for Prospects' and pro_com_id=${req.query.company_id}`;
  const project = await DBSendResponse(query);
  res.json(project);
};

exports.getAssociatedProjects = async function (req, res) {

  const { company_id, employee_id } = req.query;

  //check if either param is missing
  if (!company_id || !employee_id) {
    return res.status(400).json({ error: 'Missing required parameters: company_id and/or employee_id' });
  }

  try {
    // Check if employee is an Admin
    const empTypeQuery = `SELECT emp_type FROM employee WHERE emp_id = ${employee_id}`;
    const empResult = await DBSendResponse(empTypeQuery);
    const isAdmin = empResult.length > 0 && empResult[0].emp_type === 'Admin';

    // Build WHERE clause based on employee type
    const whereClause = isAdmin 
      ? `where pro_com_id=${company_id}`
      : `where pro_com_id=${company_id}
        AND (pro_manager_id = ${employee_id}
             OR EXISTS (
               SELECT 1 FROM projectEmployeeAssignment
               WHERE pea_pro_id = pro_id
                 AND pea_emp_id = ${employee_id}
                 AND pea_is_active = 'true'
             ))`;

    const query = `select pro_id as pid, pro_title as pname, pro_customer_id as cus_id, DDD_ID, active_plan_version, pro_starts_on as start_date, pro_ends_on as end_date, pro_manager_id,
      (select pea_emp_id as [id]
        from projectEmployeeAssignment
        inner join employee
        on pea_pro_id=pro_id
        and pea_emp_id=emp_id
        and pea_is_active='true'
        for JSON PATH) as empAssn,
      (select ploc_loc_id as [id]
        from projectLocation
        where ploc_pro_id=pro_id
        for JSON PATH) as proLoc
      from project
      ${whereClause}`;
    
    let ResultList = [];
    ResultList = await DBinsertSendResponse(query);
    
    const projList = ResultList.map((projItem) => {
      projItem.empAssn = JSON.parse(projItem.empAssn);
      projItem.proLoc = JSON.parse(projItem.proLoc);
      return projItem;
    });

    res.json(projList);
  } catch (error) {
    console.error('Error fetching associated projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
