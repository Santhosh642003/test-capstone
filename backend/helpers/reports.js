const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse, DBSendResponseParam } = require('../queries/commonQueries');
const moment = require('moment');
const { getAssociatedEmployeesAPI } = require('./employees.js');
const { getCustomersAssociatedAPI } = require('./customers.js');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
var cron = require('node-cron');

const asId = (value) => (/^\d+$/.test(String(value ?? '')) ? Number(value) : null);

// An empty array interpolates to `IN ()`, which SQL Server rejects with a syntax error.
const idList = (ids) => {
  const list = (ids || []).map(Number).filter(Number.isInteger);
  return list.length > 0 ? list.join(', ') : '-1';
};

// Customer-level report rows have no project of their own, so a Programs filter keeps a
// customer when it has at least one project in that program. `customerAlias` is the alias
// the surrounding query uses for the customer table.
function customerInProgramFilter(program_id, customerAlias = 'customer') {
  return ` AND EXISTS (SELECT 1 FROM project p WHERE p.pro_customer_id = ${customerAlias}.cus_id AND p.pro_program_id = ${program_id})`;
}

// Office Location / Programs filters for reports whose rows reach a task and its project directly.
function taskProjectFilters(req, taskAlias = 't', projectAlias = 'p') {
  const oloc_id = asId(req.query.oloc_id);
  const program_id = asId(req.query.program_id);

  return (oloc_id ? ` AND ${taskAlias}.tas_oloc_id = ${oloc_id}` : '') + (program_id ? ` AND ${projectAlias}.pro_program_id = ${program_id}` : '');
}

// Same filters for reports anchored on master_schedule, which has no task of its own — a schedule qualifies when one of its sessions' tasks matches.
function scheduleTaskFilters(req, scheduleAlias = 'ms') {
  const oloc_id = asId(req.query.oloc_id);
  const program_id = asId(req.query.program_id);

  const sessionTask = (extraJoin, condition) => ` AND EXISTS (
      SELECT 1 FROM sessions fs
        JOIN task ft ON ft.tas_id = fs.task_id${extraJoin}
      WHERE fs.schedule_id = ${scheduleAlias}.schedule_id AND ${condition})`;

  return (oloc_id ? sessionTask('', `ft.tas_oloc_id = ${oloc_id}`) : '')
    + (program_id ? sessionTask('\n        JOIN project fp ON fp.pro_id = ft.tas_pro_id', `fp.pro_program_id = ${program_id}`) : '');
}

function calculateUnits(minutes, unitDuration) {
  if (minutes < unitDuration) return 1;

  const fullUnits = Math.floor(minutes / unitDuration);
  const remainder = minutes % unitDuration;

  if (remainder >= unitDuration / 2) {
    return fullUnits + 1;
  } else {
    return fullUnits;
  }
}

// Map of report keys to their column definitions
// These definitions match the frontend report components
const reportColumnDefinitions = {
  'activeCustomer': [
    { field: 'cus_id', headerName: 'Customer ID' },
    { field: 'cus_name', headerName: 'Customer Name' },
    { field: 'gender', headerName: 'Gender' },
    { field: 'cus_address', headerName: 'Address' },
    { field: 'cus_phone', headerName: 'Phone' },
    { field: 'cus_email', headerName: 'Email' },
    { field: 'cus_acquired_date', headerName: 'Acquired Date' },
    { field: 'renewal_date', headerName: 'Renewal Date' },
    { field: 'medicaid_eligible', headerName: 'Medicaid Eligible' },
    { field: 'medicaid_id', headerName: 'Medicaid ID' },
    { field: 'waiver_program', headerName: 'Waiver Program' },
    { field: 'PrimaryDiagnosisCode', headerName: 'Primary Diagnosis Code' },
    { field: 'MedicaidEndDate', headerName: 'Medicaid End Date' },
    { field: 'AgencyAssignDate', headerName: 'Agency Assign Date' },
    { field: 'County', headerName: 'County' },
    { field: 'LastAnnualVisitDate', headerName: 'Last Annual Visit Date' },
    { field: 'ProDescription', headerName: 'Service Code' }
  ],
  'tasks': [
    { field: 'id', headerName: 'ID' },
    { field: 'tas_id', headerName: 'Task ID' },
    { field: 'tas_start_date', headerName: 'Task Date' },
    { field: 'emp_id', headerName: 'Employee ID' },
    { field: 'emp_last_name', headerName: 'Employee Last Name' },
    { field: 'emp_first_name', headerName: 'Employee First Name' },
    { field: 'emp_local_id', headerName: 'Employee Local ID' },
    { field: 'cus_id', headerName: 'Customer ID' },
    { field: 'cus_last_name', headerName: 'Customer Last Name' },
    { field: 'cus_first_name', headerName: 'Customer First Name' },
    { field: 'cus_local_id', headerName: 'Customer Local ID' },
    { field: 'tas_type', headerName: 'Task Type' },
    { field: 'tas_duration', headerName: 'Task Duration (Hrs)' },
    { field: 'compensation_rate', headerName: 'Rate' }
  ],
  'planRenewal': [
    { field: 'id', headerName: 'ID' },
    { field: 'ddd_id', headerName: 'DDD ID' },
    { field: 'program', headerName: 'Program' },
    { field: 'customer_name', headerName: 'Customer Name' },
    { field: 'coordinator_name', headerName: 'Coordinator Name' },
    { field: 'dob', headerName: 'DOB' },
    { field: 'plan_approval_date', headerName: 'Plan Approval Date' },
    { field: 'plan_start_date', headerName: 'Plan Start Date' },
    { field: 'plan_end_date', headerName: 'Plan End Date' }
  ],
  'clientTermination': [
    { field: 'cus_id', headerName: 'Customer ID' },
    { field: 'DDDID', headerName: 'DDD ID' },
    { field: 'cus_name', headerName: 'Customer Name' },
    { field: 'cus_status', headerName: 'Customer Status' },
    { field: 'TransferOutDate', headerName: 'Transfer Out Date' },
    { field: 'TransferOutReason', headerName: 'Transfer Out Reason' }
  ],
  'clientStatus': [
    { field: 'cus_id', headerName: 'Customer ID' },
    { field: 'DDDID', headerName: 'DDD ID' },
    { field: 'cus_name', headerName: 'Customer Name' },
    { field: 'cus_status', headerName: 'Customer Status' },
    { field: 'cus_created_at', headerName: 'Customer Created At' },
    { field: 'TransferOutDate', headerName: 'Transfer Out Date' }
  ],
  'customerContacts': [
    { field: 'con_first_name', headerName: 'Contact First Name' },
    { field: 'con_last_name', headerName: 'Contact Last Name' },
    { field: 'con_address', headerName: 'Contact Address' },
    { field: 'con_phone', headerName: 'Contact Phone' },
    { field: 'con_designation', headerName: 'Contact Designation' },
    { field: 'con_contact_type', headerName: 'Contact Type' },
    { field: 'con_email', headerName: 'Contact Email' }
  ],
  'timeManagement': [
    { field: 'TaskcreateDate', headerName: 'Date Entered' },
    { field: 'Project', headerName: 'Project' },
    { field: 'TaskName', headerName: 'Task Name' },
    { field: 'TaskType', headerName: 'Type' },
    { field: 'FirstName', headerName: 'Employee First Name' },
    { field: 'LastName', headerName: 'Employee Last Name' },
    { field: 'empName', headerName: 'Employee Name' },
    { field: 'RecActivityDate', headerName: 'Activity Date' },
    { field: 'RecStartTime', headerName: 'Start Time' },
    { field: 'RecEndTime', headerName: 'End Time' },
    { field: 'WeeklyHrs', headerName: 'Hours' },
    { field: 'TaskNotes', headerName: 'Comments' },
    { field: 'CaseNotes', headerName: 'Notes' }
  ],
  'scVisit': [
    { field: 'customer_name', headerName: 'Customer Name' },
    { field: 'ddd_id', headerName: 'DDD ID' },
    { field: 'local_id', headerName: 'Local ID' },
    { field: 'month1', headerName: 'Month 1' },
    { field: 'month2', headerName: 'Month 2' },
    { field: 'month3', headerName: 'Month 3' },
    { field: 'month4', headerName: 'Month 4' },
    { field: 'month5', headerName: 'Month 5' },
    { field: 'month6', headerName: 'Month 6' },
    { field: 'month7', headerName: 'Month 7' },
    { field: 'month8', headerName: 'Month 8' },
    { field: 'month9', headerName: 'Month 9' },
    { field: 'month10', headerName: 'Month 10' },
    { field: 'month11', headerName: 'Month 11' },
    { field: 'month12', headerName: 'Month 12' },
    { field: 'service_plan', headerName: 'Service Plan' },
    { field: 'program', headerName: 'Program' },
    { field: 'mt_submission_date', headerName: 'MT Submit Date' },
    { field: 'plan_approval_date', headerName: 'Plan Approval Date' },
    { field: 'plan_start_date', headerName: 'Plan Start Date' },
    { field: 'plan_end_date', headerName: 'Plan End Date' },
    { field: 'last_annual_visit', headerName: 'Last Annual Visit' },
    { field: 'last_mt_upload', headerName: 'Last MT Upload' }
  ],
  'evvReport': [
    { field: 'Provider', headerName: 'Service Provider' },
    { field: 'Receiver', headerName: 'Service Receiver' },
    { field: 'TaskType', headerName: 'Type' },
    { field: 'DateofService', headerName: 'Date' },
    { field: 'StarttoEnd', headerName: 'Time' },
    { field: 'Location', headerName: 'Location' }
  ]
};

exports.getReportColumns = async (req, res) => {
  try {
    const { base_report, company_id } = req.query;

    if (!base_report) {
      return res.status(400).json({ error: 'base_report is required' });
    }

    // Check if we have a predefined column definition for this report
    if (reportColumnDefinitions[base_report]) {
      // If the report is Active Customers, also fetch custom schema columns
      if (base_report === 'activeCustomer' && company_id) {
        try {
          const schemaQuery = `IF EXISTS (SELECT 1 FROM fwschema WHERE companyID = ${company_id})
                          BEGIN
                              SELECT columnName, columnLabel FROM fwschema WHERE companyID = ${company_id} AND columnVisible = 1
                          END
                          ELSE
                          BEGIN
                              SELECT columnName, columnLabel FROM fwschema WHERE companyID = -1 AND columnVisible = 1
                          END`;

          const schemaColumns = await DBSendResponse(schemaQuery);

          if (schemaColumns && schemaColumns.length > 0) {
            const customColumns = schemaColumns.map(item => ({
              field: item.columnName,
              headerName: item.columnLabel
            }));

            // Combine custom schema columns with base columns
            return res.json({
              columns: [...customColumns, ...reportColumnDefinitions[base_report]]
            });
          }
        } catch (schemaErr) {
          console.error('Error fetching schema columns:', schemaErr);
          // Fall back to default columns if schema query fails
        }
      }

      return res.json({ columns: reportColumnDefinitions[base_report] });
    }

    // If no predefined definition exists, return an empty array or error
    return res.json({
      columns: [],
      message: 'No column definitions found for this report'
    });

  } catch (err) {
    console.error('Error in getReportColumns:', err);
    res.status(500).json({ error: 'Failed to fetch report columns' });
  }
};

exports.getManagerReports = async (req, res) => {
  const query = `select DDDID,pro_id,pro_manager_id,pro_title,pro_ends_on,cus_id,cus_name,(Select emp_first_name from employee where emp_id = pro_manager_id) as ManagerFirstName, (Select emp_last_name from employee where emp_id = pro_manager_id) as ManagerLastName,(Select * from getAllTasks(pro_id,0)
    for JSON PATH) as activeTasks,(Select * from getAllTasks(pro_id,1)
    for JSON PATH) as completedTasks from customer,project where pro_com_id=2004 and pro_customer_id=cus_id`;
  let result = await DBSendResponse(query);
  // const projectslistQuery = `select pro_id from project where exists (
  //       select pea_pro_id from projectEmployeeassignment,employee where emp_id=pea_emp_id and pro_id=pea_pro_id and pea_is_active='true' and (emp_manager_id=${req.query.emp_id} or emp_id=${req.query.emp_id}))`
  // const projresult = await DBSendResponse(projectslistQuery)
  result = result.map((rep) => {
    rep.activeTasks = JSON.parse(rep.activeTasks) ? JSON.parse(rep.activeTasks) : [];
    // rep.activeTasks = rep.activeTasks.slice(Math.max(rep.activeTasks.length - 3, 1))
    rep.completedTasks = JSON.parse(rep.completedTasks) ? JSON.parse(rep.completedTasks) : [];
    // rep.completedTasks = rep.completedTasks.slice(Math.max(rep.completedTasks.length - 3, 1))
    return rep;
  });
  if (req.query.type) {
    result = result.map((rep) => {
      rep.activeTasks = rep.activeTasks.filter((tas) => tas.tas_type === req.query.type);
      // rep.activeTasks = rep.activeTasks.length < 3?rep.activeTasks:rep.activeTasks.slice(Math.max(rep.activeTasks.length - 3, 0))
      rep.completedTasks = rep.completedTasks.filter((tas) => tas.tas_type === req.query.type);
      // rep.completedTasks = rep.completedTasks.length < 3?rep.completedTasks:rep.completedTasks.slice(Math.max(rep.completedTasks.length - 3, 0))
      return rep;
    });
  } else {
    result = result.map((rep) => {
      // rep.activeTasks = rep.activeTasks.length < 3?rep.activeTasks:rep.activeTasks.slice(Math.max(rep.activeTasks.length - 3, 0))
      // rep.completedTasks = rep.completedTasks.length < 3?rep.completedTasks:rep.completedTasks.slice(Math.max(rep.completedTasks.length - 3, 0))
      rep.activeTasks = rep.activeTasks;
      rep.completedTasks = rep.completedTasks;
      return rep;
    });
  }

  // result = result.map((rep) => {
  //   if (projresult.find((pro) => pro.pro_id === rep.pro_id)) {
  //     return rep
  //   } else {
  //     return null
  //   }
  // }).filter((rep) => !!rep)
  // console.log(result.length, projresult.length)
  res.json(result);
};

exports.getEmpReports = async (req, res) => {
  const query = `select DDDID,emp_id,emp_first_name,emp_last_name,pro_id,pro_manager_id,pro_title,pro_ends_on,cus_id,cus_name,(Select emp_first_name from employee where emp_id = pro_manager_id) as ManagerFirstName, (Select emp_last_name from employee where emp_id = pro_manager_id) as ManagerLastName, (Select * from getEmpTasks(pro_id,emp_id,0)
    for JSON PATH) as activeTasks,(Select * from getEmpTasks(pro_id,emp_id,1)
    for JSON PATH) as completedTasks from employee,projectEmployeeAssignment,customer,project where pro_com_id=emp_company_id and emp_id=${req.query.emp_id} and pea_emp_id=emp_id and pea_pro_id=pro_id and pro_customer_id=cus_id and pea_is_active='true'`;

  let result = await DBSendResponse(query);
  result = result.map((rep) => {
    rep.activeTasks = JSON.parse(rep.activeTasks) ? JSON.parse(rep.activeTasks) : [];
    // rep.activeTasks = rep.activeTasks.slice(Math.max(rep.activeTasks.length - 3, 1))
    rep.completedTasks = JSON.parse(rep.completedTasks) ? JSON.parse(rep.completedTasks) : [];
    // rep.completedTasks = rep.completedTasks.slice(Math.max(rep.completedTasks.length - 3, 1))
    return rep;
  });
  if (req.query.type) {
    result = result.map((rep) => {
      rep.activeTasks = rep.activeTasks.filter((tas) => tas.tas_type === req.query.type);
      // rep.activeTasks = rep.activeTasks.length < 3?rep.activeTasks:rep.activeTasks.slice(Math.max(rep.activeTasks.length - 3, 0))
      rep.completedTasks = rep.completedTasks.filter((tas) => tas.tas_type === req.query.type);
      // rep.completedTasks = rep.completedTasks.length < 3?rep.completedTasks:rep.completedTasks.slice(Math.max(rep.completedTasks.length - 3, 0))
      return rep;
    });
  } else {
    result = result.map((rep) => {
      rep.activeTasks = rep.activeTasks;
      rep.completedTasks = rep.completedTasks;
      // rep.activeTasks = rep.activeTasks.length < 3?rep.activeTasks:rep.activeTasks.slice(Math.max(rep.activeTasks.length - 3, 0))
      // rep.completedTasks = rep.completedTasks.length < 3?rep.completedTasks:rep.completedTasks.slice(Math.max(rep.completedTasks.length - 3, 0))
      return rep;
    });
  }
  res.json(result);
};

exports.getTimesheets = async (req, res) => {
  let customConditions = '';

  if (req.query.customFilter) {
    const customFilter = JSON.parse(req.query.customFilter);

    if (customFilter.Project) {
      customConditions += ` AND p.pro_title LIKE '%${customFilter.Project}%'`;
    }
    if (customFilter.FirstName) {
      customConditions += ` AND e.emp_first_name LIKE '%${customFilter.FirstName}%'`;
    }
    if (customFilter.LastName) {
      customConditions += ` AND e.emp_last_name LIKE '%${customFilter.LastName}%'`;
    }
    if (customFilter.TaskType) {
      customConditions += ` AND t.tas_type LIKE '%${customFilter.TaskType}%'`;
    }
    if (customFilter.RecActivityDate) {
      customConditions += ` AND CONVERT(VARCHAR, el.empLocdate, 101) = '${customFilter.RecActivityDate}'`;
    }
    if (customFilter.TaskcreateDate) {
      customConditions += ` AND CONVERT(VARCHAR, t.tas_created_at, 101) = '${customFilter.TaskcreateDate}'`;
    }
    if (customFilter.WeeklyHrs) {
      customConditions += ` AND taskHrs LIKE '%${customFilter.WeeklyHrs}%'`;
    }
  }

  // date range from the report's From/To pickers — only accept plain YYYY-MM-DD
  const isDateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (isDateOnly(req.query.start_date)) {
    customConditions += ` AND el.empLocdate >= '${req.query.start_date}'`;
  }
  if (isDateOnly(req.query.end_date)) {
    customConditions += ` AND el.empLocdate < DATEADD(day, 1, '${req.query.end_date}')`;
  }

  const olocId = asId(req.query.oloc_id);
  const programId = asId(req.query.program_id);

  if (olocId) {
    customConditions += ` AND t.tas_oloc_id = ${olocId}`;
  }
  if (programId) {
    customConditions += ` AND p.pro_program_id = ${programId}`;
  }

  let associatedEmployees = await getAssociatedEmployeesAPI(req.query.emp_id);
  associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({ emp_id: req.query.emp_id });

  associatedEmployees = associatedEmployees.filter((obj, index, self) => {
    return index === self.findIndex((t) => (
      t.emp_id === obj.emp_id
    ));
  }).map((emp) => emp.emp_id).join(', ');

  const currentPage = req.query.page ? req.query.page : 0;
  const pageSize = req.query.page_size ? req.query.page_size : 10;

  let countQuery = `SELECT COUNT(*)
  FROM empLocate el
  JOIN task t ON el.taskId = t.tas_id
  LEFT JOIN employee e ON el.empId = e.emp_id
  LEFT JOIN project p ON el.projId = p.pro_id
  WHERE t.tas_com_id = ${req.query.comp_id} AND t.tas_is_active != 2 ${customConditions}`;

  let query = `SELECT el.empLocId as id, el.empLocdate as start_time, el.checkoutEmpDate as end_time, el.empLocate_timezone, e.emp_id, e.emp_first_name, e.emp_last_name, e.emp_type, e.emp_company_id, e.emp_manager_id, p.pro_title, p.pro_created_at, p.pro_starts_on, t.tas_created_at, t.tas_title, t.tas_type, t.tas_start_date, t.tas_start_time, t.tas_end_date, t.tas_end_time, t.task_emp_timezone, t.tas_notes,
    CAST(DATEDIFF(minute, el.empLocdate, el.checkoutEmpDate) / 60.0 AS DECIMAL(10, 2)) as taskHrs,
    (SELECT * FROM projectEmployeeAssignment WHERE pea_pro_id = projId and pea_emp_id = empId AND pea_is_active = 'true' for JSON PATH) as paymentDets, 
    (Select comment_text FROM comments WHERE task_id = taskId for JSON PATH) as taskComments 
    FROM empLocate el
    JOIN task t ON el.taskId = t.tas_id
    LEFT JOIN employee e ON el.empId = e.emp_id
    LEFT JOIN project p ON el.projId = p.pro_id
    WHERE t.tas_com_id = ${req.query.comp_id} AND t.tas_is_active != 2 ${customConditions}`;

  if (req.query.emp_type !== 'Admin') {
    query += ` AND e.emp_id in (${associatedEmployees})`;
    countQuery += ` AND e.emp_id in (${associatedEmployees})`;
  }

  const orderByQuery = ' ORDER BY checkoutEmpDate desc';
  const paginateQuery = ` OFFSET ${currentPage * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;

  query = `${query} ${orderByQuery} ${paginateQuery}`;

  let timesheetsData = await DBSendResponse(query);
  const totalCount = await DBSendResponse(countQuery);

  timesheetsData = timesheetsData.map((ts) => {
    ts.paymentDets = !ts.paymentDets ? null : JSON.parse(ts.paymentDets)[0];
    ts.taskComments = !ts.taskComments ? null : JSON.parse(ts.taskComments);
    return ts;
  });

  const responseData = {
    timesheetsData: timesheetsData,
    count: totalCount[0][''],
  };

  res.send(responseData);
};

exports.getActiveCustomers = async (req, res) => {
  let company_id = JSON.parse(req.query.com_id);
  let employee_id = JSON.parse(req.query.emp_id);
  let companyTypeOfBusiness = JSON.parse(req.query.pBusinessType);
  let program_id = req.query.program_id ? JSON.parse(req.query.program_id) : null;

  let associatedCustomers = await getCustomersAssociatedAPI(company_id, employee_id);

  let cus_ids = [];
  associatedCustomers = associatedCustomers.filter((customer) => customer.cus_status === 'Active');

  associatedCustomers.forEach((customer) => cus_ids.push(customer.cus_id));

  const schemaQuery = `IF EXISTS (SELECT 1 FROM fwschema WHERE companyID = ${company_id})
                BEGIN
                    SELECT columnName, columnLabel FROM fwschema WHERE companyID = ${company_id} AND tableName = 'customer' AND columnVisible = 1
                END
                ELSE
                BEGIN
                    SELECT columnName, columnLabel FROM fwschema WHERE companyID = -1 AND companyTypeOfBusiness = ${companyTypeOfBusiness > 99 ? companyTypeOfBusiness : -1} AND tableName = 'customer' AND columnVisible = 1
                END`;

  const schema = await DBSendResponse(schemaQuery);

  const schemaColumns = schema?.map(row => `customer.${row.columnName}`).join(', ');
  const baseColumns = 'cus_id, cus_name, gender, cus_address, cus_phone, cus_email, cus_acquired_date, renewal_date, medicaid_eligible, medicaid_id, waiver_program, PrimaryDiagnosisCode, MedicaidEndDate, AgencyAssignDate, County, LastAnnualVisitDate';

  const allColumns = schemaColumns ? `${schemaColumns}, ${baseColumns}` : baseColumns;

  const programFilter = program_id ? ` AND pro_program_id = ${program_id}` : '';

  const query = `SELECT DISTINCT ${allColumns}
              FROM customer
              JOIN project ON cus_id = pro_customer_id
            WHERE pro_is_active = 'True' AND cus_id IN (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})${programFilter}`;

  let result = await DBSendResponse(query);

  res.json({
    data: result,
    schemaColumns: schema.map(item => ({ 'field': item.columnName, 'headerName': item.columnLabel }))
  });
};

exports.getTasks = async (req, res) => {
  try {
    let com_id = req.query.com_id ? JSON.parse(req.query.com_id) : null;
    let emp_id = req.query.emp_id ? JSON.parse(req.query.emp_id) : null;
    let oloc_id = req.query.oloc_id ? JSON.parse(req.query.oloc_id) : null;
    let program_id = req.query.program_id ? JSON.parse(req.query.program_id) : null;

    if (!com_id) {
      return res.status(400).json({ error: 'com_id is required' });
    }

    const officeFilter = oloc_id ? ` and t.tas_oloc_id = ${oloc_id}` : '';
    const programFilter = program_id ? ` and p.pro_program_id = ${program_id}` : '';

    const query = `SELECT tas_id, tas_start_date, emp_id, emp_last_name, emp_first_name, emp_local_id, compensation_rate, cus_id, cus_name, cus_local_id, tas_type, tas_end_time, tas_start_time, empLocdate, checkoutEmpDate, empLocate_timezone
  FROM task t
    JOIN employee e on t.tas_emp_id = e.emp_id
    JOIN project p on t.tas_pro_id = p.pro_id
    JOIN customer c on p.pro_customer_id = c.cus_id
    JOIN empLocate el on t.tas_id = el.taskId
  WHERE t.tas_com_id = ${com_id} and empLocdate >= '${req.query.start}' and empLocdate <= '${req.query.end}' and tas_type != 'Checklist' and tas_is_active != 2${officeFilter}${programFilter}`;

    if (req.query.type === 'Admin') {
      let result = await DBSendResponse(query);

      res.json(result);
    }

    else {
      let associatedEmployees = await getAssociatedEmployeesAPI(emp_id);
      associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({ emp_id: emp_id });

      associatedEmployees = associatedEmployees.filter((obj, index, self) => {
        return index === self.findIndex((t) => (
          t.emp_id === obj.emp_id
        ));
      });

      let result = await DBSendResponse(query);

      let finalResult = [];
      for (const employee of associatedEmployees) {
        let empData = result.filter((emp) => emp.emp_id === employee.emp_id);
        finalResult.push(...empData);
      }

      res.json(finalResult);
    }
  } catch (err) {
    console.error('Error in getTasks:', err);
    res.status(500).json({ error: 'Error fetching tasks', message: err.message });
  }
};

exports.getPreAuth = async (req, res) => {
  const companyID = req.query.companyID;
  const custID = req.query.custID;

  const preAuthQuery = `SELECT *, 
  (select * 
    from task t 
    join dropdowns dd on dd.EntityValue = t.tas_type and dd.CompanyID = t.tas_com_id
    join TaskProcCodeMapping tpcm on tpcm.dropdown_id = dd.ddID
    join procedure_code pc on pc.procCode_id = tpcm.procedure_code_id AND state_id = 'NJ'
    join empLocate el on t.tas_id = el.taskId
  where t.tas_pro_id = pro.pro_id AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND t.tas_billable_by_default = 'True' AND t.tas_is_active != 2 for JSON PATH) as tasks
FROM preAuth pa 
  LEFT JOIN customer c ON c.DDDID = pa.DDDID
  LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND pro.pro_is_active = 'True'
WHERE companyID = ${companyID} and c.cus_id = ${custID}`;

  let preAuthData = await DBSendResponse(preAuthQuery);

  preAuthData = preAuthData.map((obj) => {
    obj.tasks = JSON.parse(obj.tasks);

    if (obj.tasks !== null) {
      obj.tasks = obj.tasks.filter((taskObj) => {
        // return taskObj.procProcCode + (taskObj.procModifierCode ? taskObj.procModifierCode.replaceAll(":", '') : '') === obj.procedureCode + (obj.procedureCodeModifier ? obj.procedureCodeModifier.replaceAll(":", '') : '');
        return taskObj.procProcCode === obj.procedureCode;
      });
    } else {
      obj.tasks = [];
    }
    obj.taskIds = '';
    obj.cumulativeUnits = 0;
    obj.remainingUnits = 0;
    obj.cumulativeMinutes = 0;
    if (obj.tasks.length !== 0) {
      obj.taskIds = obj.tasks.map((e) => e.tas_id).join(', ');
      obj.cumulativeMinutes = obj.tasks.map((e) => moment(e.checkoutEmpDate).diff(moment(e.empLocdate), 'm')).reduce((a, b) => a + b, 0);
      if (obj.tasks[0].procUnitOfService === '15 Minutes') {
        obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 15);
      }
      else if (obj.tasks[0].procUnitOfService === '1 Hour') {
        obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 60);
      }
      else {
        obj.cumulativeUnits = obj.tasks.length;
      }
    }
    obj.remainingUnits = obj.authUnits - obj.cumulativeUnits;
    return { ...obj };
  });

  preAuthData.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  const groupedData = {};

  preAuthData.forEach(item => {
    const key = `${item.cus_id}-${item.procedureCode + (item.procedureCodeModifier ? item.procedureCodeModifier.replaceAll(':', '') : '')}`;
    if (!groupedData[key]) {
      groupedData[key] = [];
    }
    groupedData[key].push(item);
  });

  for (const key in groupedData) {
    let prevRemainingUnits = 0;
    for (const item of groupedData[key]) {
      if (item.isNewPlan === 'Yes') {
        prevRemainingUnits = 0;
      }
      item.remainingUnits += prevRemainingUnits;
      prevRemainingUnits = item.remainingUnits;
    }
  }

  const ungroupedData = [].concat(...Object.values(groupedData));

  res.json(ungroupedData);
};

exports.getServiceAuth = async (req, res) => {
  const companyID = req.query.companyID;
  const employee_id = req.query.emp_id;

  if (companyID && employee_id && req.query.start && req.query.end) {
    analytics.track({
      userId: String(employee_id),
      event: 'Service Authorization Report Generated',
      context: {
        groupId: companyID,
      },
      properties: {
        companyId: companyID,
        startDate: moment(req.query.start).format('MM/DD/YYYY'),
        endDate: moment(req.query.end).format('MM/DD/YYYY'),
      }
    });
    console.log('logged to segment successfully');
  }

  const preAuthQuery = `SELECT *
FROM preAuth pa 
  LEFT JOIN customer c ON c.DDDID = pa.DDDID
  LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND pro.pro_is_active = 'True'
where companyID = ${companyID} and pa.startDate >= '${req.query.start}' and pa.startDate <= '${req.query.end}'`;

  let preAuthData = await DBSendResponse(preAuthQuery);

  res.json(preAuthData);
};

exports.getLateMT = async (req, res) => {
  let company_id = JSON.parse(req.query.com_id);
  let employee_id = JSON.parse(req.query.emp_id);

  let associatedCustomers = await getCustomersAssociatedAPI(company_id, employee_id);

  let cus_ids = [];
  associatedCustomers = associatedCustomers.filter((customer) => customer.cus_status === 'Active');

  associatedCustomers.forEach((customer) => cus_ids.push(customer.cus_id));

  // List all active customers with plan end date beyond the current month end
  const activeCustQuery = `SELECT c.cus_id, c.cus_name, p.pro_ends_on 
  FROM customer c 
  INNER JOIN project p ON p.pro_customer_id = c.cus_id
  WHERE pro_is_active = 'True' AND p.pro_ends_on >= DATEADD(mm, DATEDIFF(m, 0, GETDATE()) + 1, 0) AND pro_com_id = ${company_id} AND c.cus_id IN (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;

  let activeCustomers = await DBSendResponse(activeCustQuery);

  const query = `SELECT t.tas_id, t.tas_mm_id, t.tas_mm_status, c.cus_id, c.cus_name, p.pro_ends_on, e.emp_first_name, e.emp_last_name,
  (SELECT emp_first_name, emp_last_name FROM employee emp WHERE emp.emp_id = e.emp_manager_id for JSON PATH) as SC_MANAGER
  FROM monthlymonitoring m
  INNER JOIN task t ON t.tas_id = m.task_id AND t.tas_mm_id IS NOT NULL AND m.mt_period = '${req.query.period}'
  INNER JOIN project p ON p.pro_id = t.tas_pro_id
  INNER JOIN customer c ON c.cus_id = p.pro_customer_id
  INNER JOIN employee e ON e.emp_id = m.employee_id
  WHERE pro_is_active = 'True' AND p.pro_ends_on >= DATEADD(mm, DATEDIFF(m, 0, GETDATE()) + 1, 0) AND pro_com_id = ${company_id} AND c.cus_id IN (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;

  let result = await DBSendResponse(query);

  result = result.map((rep) => {
    rep.SC_MANAGER = JSON.parse(rep.SC_MANAGER);
    return rep;
  });

  let filteredActiveCustomers = activeCustomers.filter(cust => {
    return !result.some(resultCustomer => resultCustomer.cus_id === cust.cus_id);
  });

  result.push(...filteredActiveCustomers);

  result = result.filter((res) => cus_ids.includes(res.cus_id));

  res.json(result);
};

exports.getMTSummary = async (req, res) => {
  let company_id = JSON.parse(req.query.com_id);
  let employee_id = JSON.parse(req.query.emp_id);

  let associatedCustomers = await getCustomersAssociatedAPI(company_id, employee_id);

  let cus_ids = [];
  associatedCustomers = associatedCustomers.filter((customer) => customer.cus_status === 'Active');

  associatedCustomers.forEach((customer) => cus_ids.push(customer.cus_id));

  const query = `SELECT c.cus_id, c.cus_name, m.mt_period, m.mt_type, el.empLocDate,
  (SELECT emp.emp_first_name, emp.emp_last_name
    FROM [dbo].[projectEmployeeAssignment] pea 
    JOIN [dbo].[employee] emp ON emp.emp_id = pea.pea_emp_id AND pea.pea_is_active = 'True'
    WHERE pea.pea_pro_id = pro.pro_id for JSON PATH
  ) AS SCName
  FROM [dbo].[customer] c
  JOIN [dbo].[project] pro ON c.cus_id = pro.pro_customer_id AND pro.pro_is_active = 'True'
  LEFT JOIN task t ON t.tas_pro_id = pro.pro_id AND t.tas_mm_id IS NOT NULL AND t.tas_type != 'Checklist' AND t.tas_is_active != 2
  LEFT JOIN empLocate el ON t.tas_id = el.taskId
  LEFT JOIN monthlymonitoring m ON t.tas_id = m.task_id 
  WHERE cus_status = 'Active' AND cus_company_id = ${company_id} AND cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;

  let result = await DBSendResponse(query);

  const today = new Date();
  const groupedCustomers = {};

  for (let rep of result) {
    rep.SCName = rep.SCName ? JSON.parse(rep.SCName) : [];

    if (!groupedCustomers[rep.cus_id]) {
      groupedCustomers[rep.cus_id] = {
        cus_id: rep.cus_id,
        cus_name: rep.cus_name,
        SCName: rep.SCName,
        MTData: {}
      };
    }

    const mtPeriod = rep.mt_period;
    if (!mtPeriod) continue;

    const mtPeriodDate = new Date(mtPeriod);
    const monthDifference =
      (today.getFullYear() - mtPeriodDate.getFullYear()) * 12 +
      (today.getMonth() - mtPeriodDate.getMonth());

    // Only last 12 months
    if (monthDifference >= 0 && monthDifference <= 11) {
      if (!groupedCustomers[rep.cus_id].MTData[mtPeriod]) {
        groupedCustomers[rep.cus_id].MTData[mtPeriod] = [];
      }

      groupedCustomers[rep.cus_id].MTData[mtPeriod].push({
        created_on: rep.empLocDate,
        mt_period: rep.mt_period,
        mt_type: rep.mt_type
      });
    }
  }

  res.json(Object.values(groupedCustomers));
};

exports.getSCVisits = async (req, res) => {
  const query = `SELECT c.cus_id, c.cus_name, c.DDDID, c.medicaid_eligible, c.MedicaidEndDate, c.cus_local_id, p.active_plan_version, p.LastAnnualVisitDate,
      p.LastMMTUploadDate, p.plan_program_name, p.plan_approval_date, p.pro_starts_on, p.pro_ends_on, p.pro_id, l.loc_id, l.loc_lat, l.loc_lon
      FROM projectEmployeeAssignment pea
      INNER JOIN project p
          ON pea.pea_pro_id = p.pro_id
      INNER JOIN projectLocation pl
          ON pl.pLoc_pro_id = p.pro_id
      INNER JOIN location l
          ON l.loc_id = pl.pLoc_loc_id
      INNER JOIN customer c
          ON c.cus_id = p.pro_customer_id
      WHERE pea.pea_emp_id = ${req.query.emp_id} and (p.pro_is_active=1 or((p.pro_starts_on <= '1900-01-01' and p.pro_ends_on = '1900-01-02') or (p.pro_starts_on IS NULL or p.pro_ends_on IS NULL or p.pro_starts_on <= '1900-01-01'))) and c.cus_is_active=1 and pea.pea_is_active = 1
      ORDER BY c.cus_id ASC`;
  const query2 = `select t.tas_id, tas_mm_status, t.tas_mm_id, tas_title, t.tas_type, e.checkoutEmpDate, e.empLocdate, m.data, m.submitted_on, 
      m.downloaded, m.last_download_date, c.cus_phone, p.pro_customer_id,
      (select * from location where loc_id=t.tas_loc_id or loc_id=t.tas_loc1_id or loc_id=t.tas_loc2_id for JSON PATH) as locInfo
      FROM task t
      INNER JOIN project p on t.tas_pro_id=p.pro_id 
      LEFT JOIN monthlymonitoring m on t.tas_mm_id=m.monthly_monitoring_id 
      INNER JOIN empLocate e ON t.tas_id=e.taskId
      INNER JOIN customer c on p.pro_customer_id=c.cus_id
      INNER JOIN employee emp on emp.emp_id=e.empId
      WHERE (e.checkoutEmpDate >= '${req.query.start}' AND  e.checkoutEmpDate <= '${req.query.end}') and
      emp.emp_company_id=${req.query.comp_id} AND tas_is_active <> 2 AND c.cus_is_active=1 AND
      tas_type!='Checklist'`; //and (tas_type like '%Visit%' or tas_type='Phone Call')`
  const query3 = `select a.*, p.pro_title, t.tas_title, t.tas_id, e.emp_id, e.emp_first_name, e.emp_last_name from artifacts a LEFT JOIN project p on a.project_id=p.pro_id LEFT JOIN task t on a.task_id=t.tas_id INNER JOIN employee e on a.employee_id=e.emp_id where a.employee_id=${req.query.emp_id}`;
  const query4 = `select m.monthly_monitoring_id, m.data, created_on, p.pro_customer_id from monthlymonitoring m INNER JOIN task t on t.tas_id=m.task_id INNER JOIN project p on t.tas_pro_id=p.pro_id 
    WHERE m.employee_id=${req.query.emp_id} and t.tas_mm_id IS NOT NULL 
        AND (m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 1, 0)) - 11, 0) 
        OR m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 2, 0)) - 11, 0) 
        OR m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 3, 0)) - 11, 0))
        `;
  let customers = await DBSendResponse(query) || [];
  let allTasks = await DBSendResponse(query2) || [];
  let allArtifacts = await DBSendResponse(query3) || [];
  let allMonthlyMonitoring = await DBSendResponse(query4) || [];

  customers = customers.map(async (customer) => {
    const filterTasksByMonth = (tasks, month) => {
      return tasks.filter((task) => {
        return moment(task.checkoutEmpDate).isSame(moment(req.query.end).subtract(month, 'months').startOf('month'), 'month');
      });
    };

    const filterMTSByMonth = (mts, month) => {
      return mts.filter((mt) => {
        return moment(mt.created_on).isAfter(moment().subtract(12 - month, 'months').startOf('month'));
      });
    };

    const filterMTSByType = (mts, type) => {
      return mts.filter((mt) => {
        if (!mt.data) return false;
        const data = JSON.parse(mt.data);
        if (data?.section_1?.m?.answer === type) return true;
        return false;
      });
    };

    let tasks = allTasks.filter((task) => { return task.pro_customer_id === customer.cus_id; });
    tasks = tasks.map((t) => {
      let task = { ...t };
      task.locInfo = JSON.parse(task.locInfo);
      return task;
    });

    const month1 = filterTasksByMonth(tasks, 2);
    const month2 = filterTasksByMonth(tasks, 1);
    const month3 = filterTasksByMonth(tasks, 0);
    let mts = allMonthlyMonitoring.filter((mt) => { return mt.pro_customer_id === customer.cus_id; });
    mts = filterMTSByType(mts, 'home_visit');

    let month4, month5, month6, month7, month8, month9, month10, month11, month12 = [];

    if (customer.LastAnnualVisitDate !== null) {
      let monthsSinceLastHomeVisit = moment().diff(moment(customer.LastAnnualVisitDate), 'months');
      if (monthsSinceLastHomeVisit < 11)
        month4 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 10)
        month5 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 9)
        month6 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 8)
        month7 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 7)
        month8 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 6)
        month9 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 5)
        month10 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 4)
        month11 = ['Doesn\'t need a home visit'];
      if (monthsSinceLastHomeVisit < 3)
        month12 = ['Doesn\'t need a home visit'];
      else {
        month4 = filterMTSByMonth(mts, 1);
        month5 = filterMTSByMonth(mts, 2);
        month6 = filterMTSByMonth(mts, 3);
        month7 = filterMTSByMonth(mts, 4);
        month8 = filterMTSByMonth(mts, 5);
        month9 = filterMTSByMonth(mts, 6);
        month10 = filterMTSByMonth(mts, 7);
        month11 = filterMTSByMonth(mts, 8);
        month12 = filterMTSByMonth(mts, 9);
      }
    } else {
      month4 = filterMTSByMonth(mts, 1);
      month5 = filterMTSByMonth(mts, 2);
      month6 = filterMTSByMonth(mts, 3);
      month7 = filterMTSByMonth(mts, 4);
      month8 = filterMTSByMonth(mts, 5);
      month9 = filterMTSByMonth(mts, 6);
      month10 = filterMTSByMonth(mts, 7);
      month11 = filterMTSByMonth(mts, 8);
      month12 = filterMTSByMonth(mts, 9);
    }
    const artifacts = allArtifacts.filter((artifact) => { return artifact.customer_id === customer.cus_id; });

    let hadHomeVisit = 0;
    let hadVisit = 0;
    const query = `SELECT m.monthly_monitoring_id, m.data, m.mt_period
      FROM monthlymonitoring m
      INNER JOIN task t ON t.tas_id = m.task_id
      INNER JOIN project p ON t.tas_pro_id = p.pro_id
      WHERE p.pro_customer_id = ${customer.cus_id}
      AND t.tas_mm_id IS NOT NULL
      AND m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 1, 0)) - 2, 0)`;

    let allVisits = await DBinsertSendResponse(query);
    const futureMonths = [month4, month5, month6, month7, month8, month9, month10, month11, month12].map((month, index) => {
      if (month.length > 0 || hadHomeVisit > 0) {
        const visitsThisMonth = allVisits.filter(visit => {
          const visitDate = moment(visit.mt_period);
          if (visitDate.isSameOrAfter(moment().subtract(1 - index, 'months').startOf('month')))
            return visitDate.isSameOrAfter(moment().subtract(1 - index, 'months').startOf('month'));
        });

        let homeVisit = filterMTSByType(visitsThisMonth, 'home_visit');
        let faceToFaceVisit = filterMTSByType(visitsThisMonth, 'face_to_face');

        if (hadHomeVisit > 0) {
          hadHomeVisit--;
        }

        if (hadVisit > 0) {
          hadVisit--;
        }

        if (faceToFaceVisit.length > 0 || homeVisit.length > 0 || hadVisit > 0) {
          return 'Phone Call';
        } else {
          hadVisit = 3;
          return 'Visit';
        }
      } else {
        hadHomeVisit = 12;
        hadVisit = 3;
        return 'Home Visit';
      }
    });
    return {
      ...customer,
      artifacts,
      month1: month1,
      month2: month2,
      month3: month3,
      month4: futureMonths[0],
      month5: futureMonths[1],
      month6: futureMonths[2],
      month7: futureMonths[3],
      month8: futureMonths[4],
      month9: futureMonths[5],
      month10: futureMonths[6],
      month11: futureMonths[7],
      month12: futureMonths[8]
    };
  });

  customers = await Promise.all(customers);

  const check = new Set();
  customers = customers.filter(obj => !check.has(obj.cus_id) && check.add(obj.cus_id));
  res.json(customers);
};

exports.getMTRejection = async (req, res) => {
  let company_id = JSON.parse(req.query.com_id);
  let employee_id = JSON.parse(req.query.emp_id);

  let associatedCustomers = await getCustomersAssociatedAPI(company_id, employee_id);

  let cus_ids = [];
  associatedCustomers = associatedCustomers.filter((customer) => customer.cus_status === 'Active');

  associatedCustomers.forEach((customer) => cus_ids.push(customer.cus_id));

  const query = `SELECT m.monthly_monitoring_id, m.comment, m.is_annual, m.mt_type, e.emp_first_name, e.emp_last_name,
    (SELECT action_subtype, systime
      FROM fw_log fl 
      WHERE fl.action_detail = CAST(m.monthly_monitoring_id AS VARCHAR) AND fl.action_subtype in ('MT submitted', 'MT Form rejected', 'MT Form approved') 
      ORDER BY fl.systime ASC FOR JSON PATH
    ) AS MTLOGS
  FROM monthlymonitoring m
  JOIN employee e ON e.emp_id = m.employee_id
  INNER JOIN task t ON t.tas_id = m.task_id AND t.tas_mm_id IS NOT NULL
  INNER JOIN project p ON p.pro_id = t.tas_pro_id
  INNER JOIN customer c ON c.cus_id = p.pro_customer_id
  WHERE m.mt_period = '${req.query.period}' AND e.emp_company_id = ${company_id} AND c.cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;

  let result = await DBSendResponse(query);

  result = result?.map((entry) => {
    const logs = JSON.parse(entry.MTLOGS || '[]');

    const submittedLogs = logs.filter(log => log.action_subtype === 'MT submitted').map(log => log.systime);;
    const rejectedLogs = logs.filter(log => log.action_subtype === 'MT Form rejected').map(log => log.systime);;
    const approvedLogs = logs.filter(log => log.action_subtype === 'MT Form approved').map(log => log.systime);;

    return {
      ...entry,
      MTSubmitDate: submittedLogs.length > 0 ? submittedLogs[0] : null,
      MTReSubmitDate: submittedLogs.slice(-2),
      MTRejectedDate: rejectedLogs.length > 0 ? rejectedLogs[rejectedLogs.length - 1] : null,
      MTApprovedDate: approvedLogs.length > 0 ? approvedLogs[approvedLogs.length - 1] : null
    };
  }).filter((entry) => entry.MTRejectedDate);

  res.json(result);
};

exports.getCustomerSessions = async (req, res) => {
  const associatedCustomers = await getCustomersAssociatedAPI(req.query.compID, req.query.empID);
  const cus_ids = associatedCustomers.filter((customer) => customer.cus_status === 'Active').map((customer) => customer.cus_id);

  let queryFilter = '';

  if (req.query.cus_id) {
    queryFilter = `AND c.cus_id = ${req.query.cus_id}`;
  } else {
    queryFilter = `AND c.cus_id IN (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;
  }

  queryFilter += taskProjectFilters(req);

  const query = `SELECT c.cus_name, t.tas_id, t.tas_title, t.tas_type, t.tas_start_time, t.tas_end_time, el.empLocdate, el.checkoutEmpDate, pc.procProcCode, pc.procModifierCode, pc.procUnitOfService, pa.procedureCode, pa.authUnits,
    CAST(DATEDIFF(minute, el.empLocdate, el.checkoutEmpDate) / 60.0 AS DECIMAL(10, 2)) as taskHrs
  FROM task t
    JOIN empLocate el ON el.taskId = t.tas_id
    JOIN project p ON t.tas_pro_id = p.pro_id
    JOIN customer c ON p.pro_customer_id = c.cus_id
    JOIN dropdowns dd ON dd.EntityValue = t.tas_type AND dd.CompanyID = t.tas_com_id
    LEFT JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
    LEFT JOIN procedure_code pc ON pc.procCode_id = tpcm.procedure_code_id AND state_id = 'NJ'
    LEFT JOIN preAuth pa ON pa.DDDID = c.DDDID AND pa.companyId = ${req.query.compID} AND pa.procedureCode = pc.procProcCode AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND t.tas_billable_by_default = 'True'
  WHERE t.tas_description = 'Session Task' AND t.tas_start_date >= '${req.query.start}' AND t.tas_end_date <= '${req.query.end}' AND t.tas_is_active = 1 ${queryFilter}
  ORDER BY el.checkoutEmpDate DESC`;

  let result = await DBSendResponse(query);

  result = result.map((obj) => {
    obj.unitsSpent = 0;
    obj.minutesSpent = moment(obj.checkoutEmpDate).diff(moment(obj.empLocdate), 'm');

    if (obj.procUnitOfService === '15 Minutes') {
      obj.unitsSpent = calculateUnits(obj.minutesSpent, 15);
    }
    else if (obj.procUnitOfService === '1 Hour') {
      obj.unitsSpent = calculateUnits(obj.minutesSpent, 60);
    }
    else if (!obj.procUnitOfService) {
      obj.unitsSpent = '-';
    }
    else {
      obj.unitsSpent = 1;
    }

    return { ...obj };
  });

  res.json(result);
};

exports.getEmployeeSessions = async (req, res) => {
  const query = `SELECT es.schedule_id, ms.schedule_name, ms.task_type, ms.start_time, ms.end_time, emp.emp_id, emp.emp_first_name, emp.emp_last_name
  FROM employee_schedule es
    JOIN master_schedule ms ON ms.schedule_id = es.schedule_id
    JOIN employee emp ON emp.emp_id = es.emp_id
  WHERE company_id = ${req.query.compID} AND ms.start_time >= '${req.query.start}' AND ms.end_time <= '${req.query.end}'${scheduleTaskFilters(req)};`;

  let result = await DBSendResponse(query);

  res.json(result);
};

exports.getSessionsByDate = async (req, res) => {
  const query = `SELECT c.cus_id, c.cus_name, t.tas_id, t.tas_title, t.tas_type, t.tas_start_time, t.tas_end_time, el.empLocdate, el.checkoutEmpDate, pc.procProcCode, pc.procModifierCode, pc.procUnitOfService, pa.procedureCode, pa.authUnits,
    CAST(DATEDIFF(minute, el.empLocdate, el.checkoutEmpDate) / 60.0 AS DECIMAL(10, 2)) as taskHrs
  FROM project p
    JOIN customer c ON c.cus_id = p.pro_customer_id
    LEFT JOIN task t ON t.tas_pro_id = p.pro_id  AND t.tas_description = 'Session Task' AND t.tas_start_date = '${req.query.sessionDate}' AND t.tas_is_active = 1
    LEFT JOIN empLocate el ON el.taskId = t.tas_id
    LEFT JOIN dropdowns dd ON dd.EntityValue = t.tas_type AND dd.CompanyID = t.tas_com_id
    LEFT JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
    LEFT JOIN procedure_code pc ON pc.procCode_id = tpcm.procedure_code_id AND state_id = 'NJ'
    LEFT JOIN preAuth pa ON pa.DDDID = c.DDDID AND pa.companyId = ${req.query.compID} AND pa.procedureCode = pc.procProcCode AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND t.tas_billable_by_default = 'True'
  WHERE p.pro_com_id = ${req.query.compID} AND p.pro_is_active = 'True'${taskProjectFilters(req)}`;

  let result = await DBSendResponse(query);

  result = result.map((obj) => {
    obj.unitsSpent = 0;
    obj.minutesSpent = moment(obj.checkoutEmpDate).diff(moment(obj.empLocdate), 'm');

    if (obj.procUnitOfService === '15 Minutes') {
      obj.unitsSpent = calculateUnits(obj.minutesSpent, 15);
    }
    else if (obj.procUnitOfService === '1 Hour') {
      obj.unitsSpent = calculateUnits(obj.minutesSpent, 60);
    }
    else if (!obj.procUnitOfService) {
      obj.unitsSpent = '-';
    }
    else {
      obj.unitsSpent = 1;
    }

    return { ...obj };
  });

  res.json(result);
};

exports.getSessions = async (req, res) => {
  let associatedEmployees = await getAssociatedEmployeesAPI(req.query.empID);
  associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({ emp_id: req.query.empID });

  associatedEmployees = associatedEmployees.filter((obj, index, self) => {
    return index === self.findIndex((t) => (
      t.emp_id === obj.emp_id
    ));
  }).map((emp) => emp.emp_id).join(', ');

  let query = `
  SELECT ms.*, e.*, 
    (SELECT c.cus_id, c.cus_name 
      FROM sessions s 
      JOIN customer c ON c.cus_id = s.customer_id 
      WHERE s.schedule_id = ms.schedule_id AND s.check_in_time IS NOT NULL 
    FOR JSON PATH) AS Attendees
  FROM master_schedule ms
  JOIN employee_schedule es ON es.schedule_id = ms.schedule_id
  JOIN employee e ON e.emp_id = es.emp_id
  WHERE ms.company_id = ${req.query.compID} AND ms.start_time >= '${req.query.start}' AND ms.end_time <= '${req.query.end}'${scheduleTaskFilters(req)}`;

  if (req.query.empType !== 'Admin') {
    query += ` AND e.emp_id IN (${associatedEmployees})`;
  }

  let result = await DBSendResponse(query);

  result = result.map((res) => {
    res.Attendees = JSON.parse(res.Attendees);
    return res;
  });

  res.json(result);
};

exports.getTimeAndExpenses = async (req, res) => {
  const formQuery = 'SELECT form_id FROM fw_forms where form_name = \'ECF-TME\' AND public_form = \'True\'';

  const formID = await DBSendResponse(formQuery);

  const query = `SELECT e.emp_id, e.emp_first_name, e.emp_last_name, e.compensation_rate,
    (SELECT TOP 1 time_sheet_status
      FROM time_sheet ts
      JOIN pay_period pp ON pp.pay_period_id = ts.pay_period_id
    WHERE ts.emp_id = e.emp_id AND pp.start_date >= '${moment(req.query.month).startOf('month').format('YYYY-MM-DD')}' AND pp.start_date <= '${moment(req.query.month).endOf('month').format('YYYY-MM-DDT23:59:59')}'
    ORDER BY pp.pay_period_id DESC) AS timesheetStatus,
    (SELECT t.tas_id, t.tas_title, t.tas_type, t.tas_claim_id, el.empLocdate, el.checkoutEmpDate, CAST(DATEDIFF(minute, el.empLocdate, el.checkoutEmpDate) / 60.0 AS DECIMAL(10, 2)) as taskHrs, cf.data
      FROM task t
      JOIN empLocate el ON el.taskId = t.tas_id
      LEFT JOIN customer_form cf ON cf.task_id = t.tas_id AND cf.form_type = ${formID.length === 0 ? -1 : formID[0].form_id}
    WHERE t.tas_emp_id = e.emp_id AND el.empLocdate >= '${moment(req.query.month).startOf('month').format('YYYY-MM-DD')}' AND el.empLocdate <= '${moment(req.query.month).endOf('month').format('YYYY-MM-DDT23:59:59')}' AND t.tas_is_active != 2
    FOR JSON PATH) AS empTasks
  FROM employee e
  WHERE e.emp_company_id = ${req.query.companyID} AND e.emp_is_active = 'True' AND e.compensation_type = 'Hourly'`;

  let result = await DBSendResponse(query);

  result = result.map((emp) => {
    emp.empTasks = JSON.parse(emp.empTasks);
    return emp;
  });

  result.map(employee => {
    employee.taskTypeHrs = {};
    employee.totalTaskHrs = 0;
    employee.mileage = 0;
    employee.tolls = 0;
    employee.additionalExpense = 0;

    if (employee.empTasks) {
      employee.empTasks.forEach(task => {
        if (task.data) {
          const formData = JSON.parse(task.data);
          employee.mileage += parseFloat(formData.data.mileage || 0);
          employee.tolls += parseFloat(formData.data.tolls || 0);
          employee.additionalExpense += parseFloat(formData.data.additionalExpense || 0);
        }

        if (!employee.taskTypeHrs[task.tas_type]) {
          employee.taskTypeHrs[task.tas_type] = 0;
        }
        employee.taskTypeHrs[task.tas_type] += task.taskHrs;
        employee.totalTaskHrs += task.taskHrs;
      });
    }
  });

  res.json(result);
};

exports.getClientTermination = async (req, res) => {
  const program_id = req.query.program_id ? JSON.parse(req.query.program_id) : null;
  const programFilter = program_id ? customerInProgramFilter(program_id) : '';

  const query = `SELECT * FROM customer where cus_company_id = ${req.query.com_id} AND cus_status IN ('Inactive', 'Transferred Out', 'Dormant')${programFilter}`;

  let result = await DBSendResponse(query);

  res.json(result);
};

exports.getClientStatus = async (req, res) => {
  const program_id = req.query.program_id ? JSON.parse(req.query.program_id) : null;
  const programFilter = program_id ? customerInProgramFilter(program_id) : '';

  const query = `SELECT * FROM customer where cus_company_id = ${req.query.com_id}${programFilter}`;

  let result = await DBSendResponse(query);

  res.json(result);
};

exports.getManagementReview = async (req, res) => {
  let company_id = JSON.parse(req.query.company_id);
  let employee_id = JSON.parse(req.query.emp_id);

  let associatedCustomers = await getCustomersAssociatedAPI(company_id, employee_id);
  let cus_ids = [];
  for (const customer of associatedCustomers) {
    cus_ids.push(customer.cus_id);
  }

  const query = `SELECT c.cus_id, c.cus_name, c.DDDID, t.tas_mm_id, t.tas_id, JSON_VALUE(m.data, '$.section_1.m.answer') as visit_type,
      (SELECT tas_description, tas_created_at FROM task WHERE tas_mm_id = t.tas_mm_id AND tas_type = 'Checklist' AND tas_is_active = 1 FOR JSON PATH) AS follow_up_items,
      (SELECT emp.emp_first_name, emp.emp_last_name
        FROM projectEmployeeAssignment pea 
        JOIN employee emp ON emp.emp_id = pea.pea_emp_id AND emp.emp_type = 'Support Coordinator' AND emp_is_active = 'True'
        WHERE pea.pea_pro_id = p.pro_id for JSON PATH
      ) AS SCName
    FROM monthlymonitoring m 
      INNER JOIN task t on m.task_id = t.tas_id AND tas_mm_id IS NOT NULL
      INNER JOIN project p on t.tas_pro_id = p.pro_id 
      INNER JOIN customer c on c.cus_id = p.pro_customer_id  
    WHERE p.pro_com_id = ${req.query.company_id} AND c.cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1}) AND m.mt_period = '${req.query.period}'`;

  let result = await DBSendResponse(query);

  result = result.map((rep) => {
    rep.follow_up_items = JSON.parse(rep.follow_up_items);
    rep.SCName = JSON.parse(rep.SCName);
    return rep;
  });

  res.json(result);
};

exports.getMTCompletionDetail = async (req, res) => {
  const taskQuery = `SELECT t.*, pro_id, TRIM(CONCAT(l.loc_addr_line1,' ',l.loc_addr_line2, ' ',l.loc_city, ' ',l.loc_state, ' ',l.loc_zip)) AS location_full_address 
  FROM project p 
    JOIN task t on t.tas_pro_id = p.pro_id 
    LEFT JOIN [dbo].[location] l on t.tas_loc_id = l.loc_id
  WHERE tas_mm_id IS NOT NULL AND tas_type != 'Checklist' AND tas_com_id = ${req.query.company_id}`;
  const taskData = await DBSendResponse(taskQuery);

  const managerQuery = `WITH MonthlyMonitoringCounts AS (
    SELECT 
        m.employee_id,
        SUM(CASE WHEN m.mt_period = FORMAT(GETDATE(), 'MMM yyyy') AND m.approved = 1 THEN 1 ELSE 0 END) AS approved_current,
        SUM(CASE WHEN m.mt_period = FORMAT(GETDATE(), 'MMM yyyy') AND m.submitted = 1 THEN 1 ELSE 0 END) AS submitted_current,
        SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, -1, GETDATE()), 'MMM yyyy') AND m.approved = 1 THEN 1 ELSE 0 END) AS approved_previous,
        SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, -1, GETDATE()), 'MMM yyyy') AND m.submitted = 1 THEN 1 ELSE 0 END) AS submitted_previous,
        SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, 1, GETDATE()), 'MMM yyyy') AND m.approved = 1 THEN 1 ELSE 0 END) AS approved_next,
        SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, 1, GETDATE()), 'MMM yyyy') AND m.submitted = 1 THEN 1 ELSE 0 END) AS submitted_next
    FROM [dbo].[monthlymonitoring] m
    GROUP BY m.employee_id
  ),
  ActiveCustomerCounts AS (
    SELECT 
        pea.pea_emp_id AS employee_id,
        COUNT(DISTINCT c.cus_id) AS active_customers
    FROM [dbo].[projectEmployeeAssignment] pea
    INNER JOIN [dbo].[project] p ON pea.pea_pro_id = p.pro_id AND p.pro_is_active = 1
    INNER JOIN [dbo].[customer] c ON c.cus_id = p.pro_customer_id
    GROUP BY pea.pea_emp_id
  )
  SELECT 
    e.*, 
    CONCAT(
        COALESCE(mc.approved_current, 0), '/',
        COALESCE(mc.submitted_current, 0), '/',
        COALESCE(cc.active_customers, 0)
    ) AS current_month,
    CONCAT(
        COALESCE(mc.approved_previous, 0), '/',
        COALESCE(mc.submitted_previous, 0), '/',
        COALESCE(cc.active_customers, 0)
    ) AS previous_month,
    CONCAT(
        COALESCE(mc.approved_next, 0), '/',
        COALESCE(mc.submitted_next, 0), '/',
        COALESCE(cc.active_customers, 0)
    ) AS next_month
  FROM [dbo].[employee] e
  LEFT JOIN MonthlyMonitoringCounts mc ON e.emp_id = mc.employee_id
  LEFT JOIN ActiveCustomerCounts cc ON e.emp_id = cc.employee_id
  WHERE e.emp_type IN ('Manager', 'Admin') AND e.emp_is_active = 1 AND e.emp_company_id = ${req.query.company_id};`;

  let managersData = await DBSendResponse(managerQuery);

  if (managersData && managersData.length > 0) {

    const supportCoordinatorsQuery = `WITH MonthlyMonitoringCounts AS (
      SELECT 
          employee_id,
          SUM(CASE WHEN m.mt_period = FORMAT(GETDATE(), 'MMM yyyy') AND m.approved = 1 THEN 1 ELSE 0 END) AS approved_current,
          SUM(CASE WHEN m.mt_period = FORMAT(GETDATE(), 'MMM yyyy') AND m.submitted = 1 THEN 1 ELSE 0 END) AS submitted_current,
          SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, -1, GETDATE()), 'MMM yyyy') AND m.approved = 1 THEN 1 ELSE 0 END) AS approved_previous,
          SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, -1, GETDATE()), 'MMM yyyy') AND m.submitted = 1 THEN 1 ELSE 0 END) AS submitted_previous,
          SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, 1, GETDATE()), 'MMM yyyy') AND m.approved = 1 THEN 1 ELSE 0 END) AS approved_next,
          SUM(CASE WHEN m.mt_period = FORMAT(DATEADD(mm, 1, GETDATE()), 'MMM yyyy') AND m.submitted = 1 THEN 1 ELSE 0 END) AS submitted_next
      FROM [dbo].[monthlymonitoring] m
      GROUP BY m.employee_id
    ),
    ActiveCustomerCounts AS (
      SELECT 
        pea.pea_emp_id AS employee_id,
        COUNT(DISTINCT c.cus_id) AS active_customers
      FROM [dbo].[projectEmployeeAssignment] pea
      INNER JOIN [dbo].[project] p ON pea.pea_pro_id = p.pro_id AND p.pro_is_active = 1
      INNER JOIN [dbo].[customer] c ON c.cus_id = p.pro_customer_id
      GROUP BY pea.pea_emp_id
    )
    SELECT 
      sup.emp_id AS manager_id, 
      sup.emp_first_name AS manager_first_name, 
      sup.emp_last_name AS manager_last_name, 
      e.*, 
      CONCAT(
        COALESCE(mc.approved_current, 0), '/',
        COALESCE(mc.submitted_current, 0), '/',
        COALESCE(cc.active_customers, 0)
      ) AS current_month,
      CONCAT(
        COALESCE(mc.approved_previous, 0), '/',
        COALESCE(mc.submitted_previous, 0), '/',
        COALESCE(cc.active_customers, 0)
      ) AS previous_month,
      CONCAT(
        COALESCE(mc.approved_next, 0), '/',
        COALESCE(mc.submitted_next, 0), '/',
        COALESCE(cc.active_customers, 0)
      ) AS next_month
    FROM [dbo].[employee] e 
    JOIN [dbo].[employee] sup ON e.emp_manager_id = sup.emp_id  
    LEFT JOIN MonthlyMonitoringCounts mc ON e.emp_id = mc.employee_id
    LEFT JOIN ActiveCustomerCounts cc ON e.emp_id = cc.employee_id
    WHERE sup.emp_type IN ('Manager', 'Admin') AND e.emp_is_active = 1 AND e.emp_company_id = ${req.query.company_id};`;

    const supportCoordinatorsData = await DBSendResponse(supportCoordinatorsQuery);

    let managerIds = [];
    let supportCoordinatorIds = [];

    managersData.forEach((manager) => {
      manager.suppport_coordinators = [];
      managerIds.push(manager.emp_id);
      supportCoordinatorsData.forEach((sc) => {
        supportCoordinatorIds.push(sc.emp_id);
        if (manager.emp_id === sc.manager_id) {
          manager.suppport_coordinators.push(sc);
        }
      });
    });

    supportCoordinatorIds = Array.from(new Set(supportCoordinatorIds));

    const supportCoordinatorsCustomersQuery = `SELECT DISTINCT c.*, p.pro_id, pea.pea_emp_id AS manager_id 
      FROM projectEmployeeAssignment pea
        INNER JOIN project p ON pea.pea_pro_id = p.pro_id
        INNER JOIN customer c ON c.cus_id = p.pro_customer_id
      WHERE pea.pea_emp_id IN (${idList(supportCoordinatorIds)}) and p.pro_is_active = 1 and c.cus_company_id = ${req.query.company_id}`;
    const supportCoordinatorsCustomersData = await DBSendResponse(supportCoordinatorsCustomersQuery);

    supportCoordinatorsData.forEach((sc) => {
      sc.customers = [];
      supportCoordinatorsCustomersData.forEach((mc) => {
        if (mc.manager_id === sc.emp_id) {
          mc.tasks = taskData.filter((task) => task.tas_emp_id == sc.emp_id && task.pro_id === mc.pro_id);
          sc.customers.push(mc);
        }
      });
    });

    const managersCustomersQuery = `SELECT DISTINCT c.*, p.pro_id, pea.pea_emp_id AS manager_id 
      FROM projectEmployeeAssignment pea
        INNER JOIN project p ON pea.pea_pro_id = p.pro_id
        INNER JOIN customer c ON c.cus_id = p.pro_customer_id
      WHERE pea.pea_emp_id IN (${idList(managerIds)}) and p.pro_is_active = 1 and c.cus_company_id = ${req.query.company_id}`;
    const managersCustomersData = await DBSendResponse(managersCustomersQuery);

    managersData.forEach((manager) => {
      manager.customers = [];
      managersCustomersData.forEach((mc) => {
        if (manager.emp_id === mc.manager_id) {
          mc.tasks = taskData.filter((task) => task.tas_emp_id == manager.emp_id && task.pro_id === mc.pro_id);
          manager.customers.push(mc);
        }
      });
    });
  }

  managersData = managersData.filter((manager) => manager.customers.length !== 0);

  let finalResult = [];
  if (req.query.type !== 'Admin') {
    let emp_id = JSON.parse(req.query.emp_id);

    let associatedEmployees = await getAssociatedEmployeesAPI(emp_id);
    associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({ emp_id: emp_id });

    associatedEmployees = associatedEmployees.filter((obj, index, self) => {
      return index === self.findIndex((t) => (
        t.emp_id === obj.emp_id
      ));
    });

    for (const employee of associatedEmployees) {
      let empData = managersData.filter((emp) => emp.emp_id === employee.emp_id);
      finalResult.push(...empData);
    }
  }

  const responseData = {
    code: 200,
    managersData: req.query.type === 'Admin' ? managersData : finalResult,
    count: req.query.type === 'Admin' ? managersData?.length : finalResult?.length
  };
  res.json(responseData);
};

exports.getCustomerContacts = async (req, res) => {
  let company_id = JSON.parse(req.query.com_id);
  let employee_id = JSON.parse(req.query.emp_id);
  let program_id = req.query.program_id ? JSON.parse(req.query.program_id) : null;

  let associatedCustomers = await getCustomersAssociatedAPI(company_id, employee_id);

  let cus_ids = [];
  associatedCustomers = associatedCustomers.filter((customer) => customer.cus_status === 'Active');

  associatedCustomers.forEach((customer) => cus_ids.push(customer.cus_id));

  const customerProgramFilter = program_id ? customerInProgramFilter(program_id, 'c') : '';
  const projectProgramFilter = program_id ? ` AND p.pro_program_id = ${program_id}` : '';

  const query1 = `SELECT *
  FROM contact con
    JOIN customer c ON c.cus_id = con.con_customer_id AND c.cus_status = 'Active'
  WHERE con.con_company_id = ${company_id} AND c.cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})${customerProgramFilter}`;

  let customerContacts = await DBSendResponse(query1);

  const query2 = `SELECT *
  FROM ProjectContact pc
    JOIN project p ON p.pro_id = pc.proj_id
    JOIN contact con ON con.con_id = pc.cont_id
    JOIN customer c ON c.cus_id = p.pro_customer_id
  WHERE con.con_company_id = ${company_id} AND p.pro_is_active = 'True' AND c.cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})${projectProgramFilter}`;

  let projectContacts = await DBSendResponse(query2);

  res.json([...customerContacts, ...projectContacts]);
};

exports.getPlanRenewalReport = async function (req, res) {
  const companyId = +req.query.company_id;
  const empId = +req.query.emp_id;
  const programId = req.query.program_id ? +req.query.program_id : null;

  if (!Number.isInteger(companyId) || !Number.isInteger(empId)) {
    return res.status(400).json({ error: 'company_id and emp_id are required' });
  }

  try {
    const associatedCustomers = await getCustomersAssociatedAPI(companyId, empId);

    const customerIds = associatedCustomers.map((customer) => Number(customer.cus_id)).filter(Number.isInteger);

    const monthStart = (offset) => `DATEADD(mm, DATEDIFF(m, 0, GETDATE()) + ${offset}, 0)`;

    const query = `
      SELECT pro_id, pro_title, Program, plan_approval_date, pro_starts_on, pro_ends_on, cus_name, DDDID, dob,
        CASE
          WHEN pro_ends_on < ${monthStart(1)} THEN 'Current Month'
          WHEN pro_ends_on < ${monthStart(2)} THEN 'Next Month'
          ELSE 'Next Three Months'
        END AS reports_span,
        (SELECT CONCAT(emp_first_name, ' ', emp_last_name) as employee_name
          FROM projectEmployeeAssignment
          JOIN employee ON emp_id = pea_emp_id AND pea_is_active = 'true'
          WHERE pea_pro_id = pro_id
          FOR JSON PATH
        ) AS employees
      FROM project
      JOIN customer ON cus_id = pro_customer_id
      WHERE pro_com_id = @company_id
        AND pro_ends_on >= ${monthStart(0)}
        AND pro_ends_on < ${monthStart(4)}
        AND pro_customer_id IN (${customerIds.length > 0 ? customerIds.join(', ') : -1})
        ${programId ? 'AND pro_program_id = @program_id' : ''}
      ORDER BY pro_ends_on
    `;

    const params = { company_id: companyId };
    if (programId) {
      params.program_id = programId;
    }

    const plans = await DBSendResponseParam(query, params) || [];

    const emptyRenewalReports = () => ({
      current_months_reports: [],
      next_month_reports: [],
      reports_beyond_next_month_in_current_quarter: [],
    });

    const reports = emptyRenewalReports();

    const RENEWAL_SPAN_KEYS = {
      'Current Month': 'current_months_reports',
      'Next Month': 'next_month_reports',
      'Next Three Months': 'reports_beyond_next_month_in_current_quarter',
    };

    for (const plan of plans) {
      plan.employees = plan.employees ? JSON.parse(plan.employees) : [];
      reports[RENEWAL_SPAN_KEYS[plan.reports_span]].push(plan);
    }

    res.json(reports);
  } catch (error) {
    console.log('QUERY FAILURE | getPlanRenewalReport Query Failed:');
    console.log(error);
    res.json(emptyRenewalReports());
  }
};

exports.getHomeVisitsReport = async function (req, res) {
  try {
    // const associatedCustomers = await getCustomersAssociatedAPI(req.query.compID, req.query.empID);
    // const cus_ids = associatedCustomers.filter((customer) => customer.cus_status === 'Active').map((customer) => customer.cus_id);

    let associatedEmployees = await getAssociatedEmployeesAPI(req.query.empID);
    associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({ emp_id: req.query.empID });

    associatedEmployees = associatedEmployees.filter((obj, index, self) => {
      return index === self.findIndex((t) => (
        t.emp_id === obj.emp_id
      ));
    }).map((emp) => emp.emp_id).join(', ');

    let queryFilter = '';

    if (req.query.custID) {
      queryFilter += ` AND c.cus_id = ${req.query.custID}`;
    }

    if (req.query.selectedEmpID) {
      queryFilter += ` AND e.emp_id = ${req.query.selectedEmpID}`;
    } else if (req.query.empType !== 'Admin') {
      queryFilter += ` AND e.emp_id IN (${associatedEmployees})`;
    }

    queryFilter += taskProjectFilters(req);

    let query = `
    SELECT ms.schedule_name, ms.date, ms.task_type,
      e.emp_first_name, e.emp_last_name,
      c.cus_name,
      s.session_id,
      t.tas_id
    FROM master_schedule ms
      JOIN employee_schedule es ON es.schedule_id = ms.schedule_id
      JOIN employee e ON e.emp_id = es.emp_id
      JOIN sessions s ON s.schedule_id = ms.schedule_id
      JOIN customer c ON c.cus_id = s.customer_id
      LEFT JOIN task t ON t.tas_id = s.task_id
      LEFT JOIN project p ON p.pro_id = t.tas_pro_id
      LEFT JOIN empLocate el ON el.taskId = t.tas_id
    WHERE ms.company_id = ${req.query.compID} AND ms.date >= '${req.query.start}' AND ms.date <= '${req.query.end}'${queryFilter}
    ORDER BY ms.start_time DESC
    `;

    const homeVisits = await DBSendResponse(query);

    return res.status(200).json(homeVisits);
  } catch (err) {
    console.log('QUERY FAILURE | getHomeVisitsReport Query Failed:')
    console.log(err)
    return res.status(400).json({
      message: 'An unexpected error occured',
    })
  }
};

exports.getShiftChangeLogsReport = async function (req, res) {
  try {
    let query = `
    SELECT sal.schedule_id, sal.action, sal.notes, sal.action_at,
      e1.emp_first_name AS shift_emp_first_name, e1.emp_last_name AS shift_emp_last_name,
      e2.emp_first_name AS action_by_first_name, e2.emp_last_name AS action_by_last_name,
      ms.date AS schedule_date, ms.schedule_name
    FROM shift_action_log sal
      JOIN master_schedule ms ON ms.schedule_id = sal.schedule_id
      LEFT JOIN employee e1 ON e1.emp_id = sal.shift_emp_id
      LEFT JOIN employee e2 ON e2.emp_id = sal.action_by
    WHERE sal.company_id = ${req.query.compID} AND sal.action_at >= '${req.query.start}' AND sal.action_at <= '${req.query.end}'${scheduleTaskFilters(req)}
    ORDER BY sal.action_at DESC
    `;

    const shiftChangeLogs = await DBSendResponse(query);

    return res.status(200).json(shiftChangeLogs);
  } catch (err) {
    console.log('QUERY FAILURE | getShiftChangeLogsReport Query Failed:')
    console.log(err)
    return res.status(400).json({
      message: 'An unexpected error occured',
    })
  }
};

exports.getHistoricalVisitsSummaryReport = async function (req, res) {
  try {
    let associatedEmployees = await getAssociatedEmployeesAPI(req.query.empID);
    associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({ emp_id: req.query.empID });

    associatedEmployees = associatedEmployees.filter((obj, index, self) => {
      return index === self.findIndex((t) => (
        t.emp_id === obj.emp_id
      ));
    }).map((emp) => emp.emp_id).join(', ');

    let queryFilter = '';

    if (req.query.custID) {
      queryFilter += ` AND c.cus_id = ${req.query.custID}`;
    }

    if (req.query.selectedEmpID) {
      queryFilter += ` AND e.emp_id = ${req.query.selectedEmpID}`;
    } else if (req.query.empType !== 'Admin') {
      queryFilter += ` AND e.emp_id IN (${associatedEmployees})`;
    }

    queryFilter += taskProjectFilters(req);

    let query = `
    SELECT ms.schedule_id, ms.schedule_name, ms.task_type,
      e.emp_first_name, e.emp_last_name,
      c.cus_name,
      el.empLocdate, el.checkoutEmpDate,
      sal.action, sal.notes AS action_notes, sal.action_at,
      e2.emp_first_name AS action_by_first_name, e2.emp_last_name AS action_by_last_name
    FROM master_schedule ms
      JOIN employee_schedule es ON es.schedule_id = ms.schedule_id
      JOIN employee e ON e.emp_id = es.emp_id
      JOIN sessions s ON s.schedule_id = ms.schedule_id AND s.check_out_time IS NOT NULL
      JOIN customer c ON c.cus_id = s.customer_id
      JOIN task t ON t.tas_id = s.task_id
      LEFT JOIN project p ON p.pro_id = t.tas_pro_id
      JOIN empLocate el ON el.taskId = t.tas_id
      LEFT JOIN shift_action_log sal ON sal.schedule_id = ms.schedule_id
      LEFT JOIN employee e2 ON e2.emp_id = sal.action_by
    WHERE ms.company_id = ${req.query.compID} AND ms.date >= '${req.query.start}' AND ms.date <= '${req.query.end}' AND tas_is_active = 1 ${queryFilter}
    ORDER BY ms.start_time DESC, sal.action_at ASC
    `;

    const data = await DBSendResponse(query);

    return res.status(200).json(data);
  } catch (err) {
    console.log('QUERY FAILURE | getHistoricalVisitsSummaryReport Query Failed:')
    console.log(err)
    return res.status(400).json({
      message: 'An unexpected error occured',
    })
  }
};

exports.getIncompleteShiftsReport = async function (req, res) {
  try {
    let query = `
    SELECT ms.schedule_id, ms.date, ms.start_time, ms.end_time, ms.schedule_name, ms.task_type,
      e.emp_first_name, e.emp_last_name,
      c.cus_name
    FROM master_schedule ms
      LEFT JOIN employee_schedule es ON es.schedule_id = ms.schedule_id
      LEFT JOIN employee e ON e.emp_id = es.emp_id
      LEFT JOIN sessions s ON s.schedule_id = ms.schedule_id
      LEFT JOIN customer c ON c.cus_id = s.customer_id
      LEFT JOIN task t ON t.tas_id = s.task_id
      LEFT JOIN project p ON p.pro_id = t.tas_pro_id
    WHERE ms.company_id = ${req.query.compID} AND ms.end_time < GETDATE() AND ms.date >= '${req.query.start}' AND ms.date <= '${req.query.end}' AND (es.emp_id IS NULL OR s.check_out_time IS NULL)${taskProjectFilters(req)}
    ORDER BY ms.date DESC, ms.start_time DESC
    `;

    const incompleteShifts = await DBSendResponse(query);

    return res.status(200).json(incompleteShifts);
  } catch (err) {
    console.log('QUERY FAILURE | getIncompleteShiftsReport Query Failed:')
    console.log(err)
    return res.status(400).json({
      message: 'An unexpected error occured',
    })
  }
};