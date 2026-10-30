const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');

exports.getLocationList = async function (id) {
  const query = `select loc_id as id,
				loc_addr_line1 as location_addr1,
				loc_addr_line2 as location_addr2,
				loc_city as location_city,
				loc_state as location_state,
				loc_zip as location_zip,
				loc_lat as location_lat, 
				loc_lon as location_lon,
				loc_type as location_type,
				loc_status as location_status,
				loc_county as location_county
				from location 
				where loc_is_active='true' AND loc_company_id=${id}`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  return ResultList;
};

exports.getCustomerList = async function (id) {
  const query = `select cus_id as id, cus_name as customer_name,cus_is_company,cus_email,cus_status,DDDID as ddd_id from customer where cus_company_id=${id} order by customer_name asc`;
  // const query = `select cus_id as id, cus_name as customer_name,cus_is_company,DDDID as ddd_id,(select distinct ploc_loc_id from project,projectLocation where pro_customer_id = cus_id and ploc_pro_id = pro_id for JSON PATH) as locations from customer where cus_company_id=${id}`
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  return ResultList;
  // const custList = ResultList.map((cusItem) => {
  //   // cusItem.locations = JSON.parse(cusItem.locations)
  //   return cusItem
  // })
  // return custList
};

exports.getContactList = async function (id) {
  const query = `select con_id as id,
		CONCAT ( con_first_name, ' ', con_last_name) as contact_name,con_is_active,con_company_id,con_phone,con_Addr_line1, con_Addr_line2, con_city, con_state, con_zip,con_designation,
		con_customer_id as customer_id,
		(select * from ProjectContact where cont_id = con_id for JSON PATH) as project_contacts
		from contact 
		where con_is_active='true' AND con_company_id=${id}`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  console.log('Contact List:', ResultList.filter((contact) => contact.project_contacts && contact.project_contacts.length > 0));
  return ResultList;
};

exports.getProjectList = async function (id) {
  const start = performance.now();
  try {
    let projectList = getProjectList(id);
    console.log(`/api/fieldworker/dropdowns/dropdownType/projectslist GET TIMETAKEN: ${performance.now() - start} MS`);
    return projectList;
  } catch (error) {
    console.log(`/api/fieldworker/dropdowns/dropdownType/projectslist GET ERROR: ${error.message}`);
    console.log('getProjectList ERROR:', error);
    console.log(`/api/fieldworker/dropdowns/dropdownType/projectslist GET TIMETAKEN: ${performance.now() - start} MS`);
    return [];
  }
};

async function getProjectList(id) {
  const query = `select pro_id as pid,pro_title as pname,pro_customer_id as cus_id,DDD_ID, active_plan_version, pro_starts_on as start_date,pro_ends_on as end_date,
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
	where pro_com_id=${id};`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  const projList = ResultList.map((projItem) => {
    projItem.empAssn = JSON.parse(projItem.empAssn);
    projItem.proLoc = JSON.parse(projItem.proLoc);
    return projItem;
  });

  return projList;
}

exports.getTaskList = async function (id) {
  const start = performance.now();
  try {
    let taskList = getTaskList(id);
    console.log(`/api/fieldworker/dropdowns/dropdownType/taskslist GET TIMETAKEN: ${performance.now() - start} MS`);
    return taskList;
  } catch (error) {
    console.log(`/api/fieldworker/dropdowns/dropdownType/taskslist GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/dropdowns/dropdownType/taskslist GET TIMETAKEN: ${performance.now() - start} MS`);
    return [];
  }
};

async function getTaskList(id) {
  if (!id) {
    return [];
  }

  const query = `select t.tas_id as id,t.tas_title as task_name,t.tas_pro_id,t.tas_loc_id,t.tas_loc1_id,t.tas_loc2_id,t.tas_is_active,
  t.tas_emp_id,t.tas_type, t.tas_start_time, t.tas_end_time, e.empLocdate, e.checkoutEmpDate
  from task t 
  INNER JOIN empLocate e ON e.taskId = t.tas_id
  where tas_com_id=${id};`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  return ResultList;
}

exports.getTaskListv2 = async function (req) {
  if (!req.query.comp_id) {
    res.status(400).send('Company ID is required');
  }

  let query = `select t.tas_id as id,t.tas_title as task_name,t.tas_pro_id,t.tas_loc_id,t.tas_loc1_id,t.tas_loc2_id,t.tas_is_active,
  t.tas_emp_id,t.tas_type, t.tas_start_time, t.tas_end_time, e.empLocdate, e.checkoutEmpDate
  from task t 
  INNER JOIN empLocate e ON e.taskId = t.tas_id
  where tas_com_id=${req.query.comp_id}`;

  if (req.query.projID) {
    query += ` AND tas_pro_id=${req.query.projID}`;
  }

  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  return ResultList;
};

exports.getEmployeeList = async function (id) {
  const query = `select emp_id as id, emp_type, emp_timezone,
		CONCAT ( emp_first_name, ' ', emp_last_name) as employee_name, emp_manager_id from employee where emp_is_active='true' AND emp_company_id=${id} order by employee_name asc`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  return ResultList;
};

exports.getConfigData = async function (id) {
  const query = `select * from Config where CompanyID=${id}`;
  const configList = await DBSendResponse(query);
  return configList;
};
