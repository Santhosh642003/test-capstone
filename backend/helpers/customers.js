const moment = require('moment');
const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse, generateUpdateSQL } = require('../queries/commonQueries');
const { addProject, addTask, addlocation } = require('../queries/dependantQueries');
const { getCustomerList } = require('../queries/entityGetQueries');
const { getConfigData } = require('../queries/entityGetQueries');
const { getAssociatedEmployeesAPI } = require('./employees.js');
const validators = require('./validators');
const { parseSQLText, generateSQLText } = require('../utils/validation.js');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const getProgramIdFromReq = (req) => {
  const parsed = parseInt(req.query.program_id, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const filterCustomersByProgram = async (customers, programId) => {
  const normalizedProgramId = programId === 'all' ? null : programId;
  if (!normalizedProgramId || !Array.isArray(customers) || customers.length === 0) {
    return customers;
  }

  const customerIds = customers
    .map((customer) => Number(customer.cus_id || customer.id))
    .filter((customerId) => Number.isInteger(customerId));

  if (customerIds.length === 0) {
    return [];
  }

  const allowedCustomers = await DBinsertSendResponse(
    `SELECT DISTINCT pro_customer_id AS cus_id FROM project WHERE pro_program_id=${programId} AND pro_customer_id IN (${customerIds.join(',')})`
  );
  const allowedIds = new Set(allowedCustomers.map((customer) => Number(customer.cus_id)));

  return customers.filter((customer) => {
    const customerId = Number(customer.cus_id || customer.id);
    return allowedIds.has(customerId);
  });
};


exports.getCustomers = async function (req, res) {
  if (req.query.company_id) {
    const programId = getProgramIdFromReq(req);
    const query = `select * from customer where cus_company_id=${req.query.company_id} order by cus_name asc`;
    response = await DBinsertSendResponse(query);
    response = await filterCustomersByProgram(response, programId);
    res.status(200).json(response);
    return;
  }

  res.status(500).json({
    message: 'Could not retrieve list of customers for the current company'
  });
};

exports.getCustomersAssociated = async function (req, res) {
  if (req.query.company_id) {
    if (req.query.employee_id) {
      const programId = getProgramIdFromReq(req);
      let customerList = [];

      // Get employee type
      let employee = await DBinsertSendResponse(`select emp_id,emp_first_name,emp_last_name,emp_type from employee where emp_id=${req.query.employee_id}`);
      if (employee[0].emp_type === 'Admin') {
        customerList = await DBinsertSendResponse(`select * from customer where cus_company_id=${req.query.company_id}`);
      } else {
        let managedEmployees = await getAssociatedEmployeesAPI(req.query.employee_id);
        managedEmployees = managedEmployees.directlyManaged.concat(managedEmployees.hr_managed);

        if (!managedEmployees.some(emp => emp.emp_id == req.query.employee_id)) {
          managedEmployees.push({ emp_id: Number(req.query.employee_id) });
        }

        const allCustomers = await Promise.all(
          managedEmployees.map(emp => getCustomersByDirectAssociation(emp.emp_id))
        );
        customerList = allCustomers.flat();
      }

      customerList = [...new Set(customerList.map(item => JSON.stringify(item)))].map(item => JSON.parse(item));
      customerList.sort((a, b) => a.cus_name.localeCompare(b.cus_name));
      customerList = customerList.filter((customer) => {
        const isSoftActive = customer.cus_is_active === 1 || customer.cus_is_active === true || customer.cus_is_active === '1' || customer.cus_is_active === 'true';
        const isStatusActive = String(customer.cus_status || '').trim().toLowerCase() === 'active';
        return isSoftActive || isStatusActive;
      });
      customerList = await filterCustomersByProgram(customerList, programId);

      res.status(200).json(customerList);
      return;
    }
  }

  res.status(500).json({
    message: 'Could not complete request'
  });
};

exports.getCustomersAssociatedAPI = async function (company_id, employee_id) {
  if (company_id) {
    if (employee_id) {
      let customerList = [];

      let employee = await DBinsertSendResponse(`select emp_id,emp_first_name,emp_last_name,emp_type from employee where emp_id=${employee_id}`);
      if (!Array.isArray(employee) || !employee[0]) {
        throw new Error(`Could not read employee ${employee_id} while resolving associated customers.`);
      }
      if (employee[0].emp_type == 'Admin') {
        customerList = await DBinsertSendResponse(`select * from customer where cus_company_id=${company_id}`);
      } else {
        let managedEmployees = await getAssociatedEmployeesAPI(employee_id);
        managedEmployees = managedEmployees.directlyManaged.concat(managedEmployees.hr_managed);

        if (!managedEmployees.some(emp => emp.emp_id == employee_id)) {
          managedEmployees.push({ emp_id: Number(employee_id) });
        }

        const allCustomers = await Promise.all(
          managedEmployees.map(emp => getCustomersByDirectAssociation(emp.emp_id))
        );
        customerList = allCustomers.flat();
      }

      // Deduplicate and sort
      customerList = [...new Set(customerList.map(item => JSON.stringify(item)))].map(item => JSON.parse(item));
      customerList.sort((a, b) => a.cus_name.localeCompare(b.cus_name));
      customerList = customerList.filter((customer) => {
        const isSoftActive = customer.cus_is_active === 1 || customer.cus_is_active === true || customer.cus_is_active === '1' || customer.cus_is_active === 'true';
        const isStatusActive = String(customer.cus_status || '').trim().toLowerCase() === 'active';
        return isSoftActive || isStatusActive;
      });

      return customerList;
    }
  }
};

exports.getCustomersAssociatedByProgramAPI = async function (company_id, employee_id, program_id) {
  const customerList = await exports.getCustomersAssociatedAPI(company_id, employee_id);
  return await filterCustomersByProgram(customerList, parseInt(program_id, 10));
};

const getCustomersByDirectAssociation = async function (employee_id) {
  try {
    let managedProjectCustomers = await DBinsertSendResponse(`select pro_customer_id from project where pro_manager_id=${employee_id}`);
    let assignedToProjectCustomers = await DBinsertSendResponse(
      `SELECT project.pro_customer_id FROM project 
            INNER JOIN projectEmployeeAssignment ON projectEmployeeAssignment.pea_pro_id=project.pro_id
            WHERE projectEmployeeAssignment.pea_emp_id = ${employee_id} AND pea_is_active = 1`
    );
    let foundCustomers = [...managedProjectCustomers, ...assignedToProjectCustomers];
    foundCustomers = [...new Set(foundCustomers.map(item => JSON.stringify(item)))].map(item => JSON.parse(item));

    let customerList = [];
    if (foundCustomers.length > 0) {
      const validCustomerIds = foundCustomers
        .map(item => item.pro_customer_id)
        .filter(id => id != null && id !== '');
      
      if (validCustomerIds.length > 0) {
        customerList = await DBinsertSendResponse(`SELECT * FROM customer WHERE cus_id IN (${validCustomerIds.join(', ')}) order by cus_name asc`);
      }
    }
    return customerList;
  } catch (err) {
    console.log(err);
    console.log('| WARNING | Unexpected error while finding associated customers. Ignoring this employee...');
    return [];
  }

};

exports.getCustomers = async function (req, res) {
  if (req.query.company_id) {
    const programId = getProgramIdFromReq(req);
    const query = `select * from customer where cus_company_id=${req.query.company_id} order by cus_name asc`;
    response = await DBinsertSendResponse(query);
    response = await filterCustomersByProgram(response, programId);
    res.status(200).json(response);
    return;
  }

  res.status(500).json({
    message: 'Could not retrieve list of customers for the current company'
  });
};

exports.getCustomersForReportsCentre = async function (req, res) {
  console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ', req.query);
  const currentPage = req.query.page;
  const offset = req.query.page * req.query.page_size;
  const sortOrder = req.query.sort_order ?? 'asc';
  const sortBy = req.query.sort_by ?? 'cus_name';

  let startDate = req.query.start_date;
  let toDate = req.query.end_date;
  const reportFilterDate = (req.query.reports_filter_date && moment(new Date(req.query.reports_filter_date)).format('YYYY-MM-DD')) ? moment(new Date(req.query.reports_filter_date)).format('YYYY-MM-DD') : null;

  if (startDate || toDate) {
    startDate = startDate ?? '1990-01-01';
    toDate = toDate ?? moment(new Date()).format('YYYY-MM-DD');
  }

  let associatedCustomers = await exports.getCustomersAssociatedAPI(req.query.company_id, req.query.emp_id);
  associatedCustomers = associatedCustomers.filter((cus) => cus.cus_status === 'Active');
  let cus_ids = [];
  for (const customer of associatedCustomers) {
    cus_ids.push(customer.cus_id);
  }

  try {
    if (req.query.company_id) {
      let countQuery = `select COUNT(*) from customer where cus_company_id=${req.query.company_id} AND cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;

      let query = `select * from customer where cus_company_id=${req.query.company_id} AND cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;
      let orderByQuery = `ORDER BY ${sortBy} ${sortOrder}`;
      const paginateQuery = ` OFFSET ${offset} ROWS FETCH NEXT ${req.query.page_size} ROWS ONLY`;

      if (req.query.customer_id) {
        query = `${query} AND cus_id=${req.query.customer_id}`;
        countQuery = `${countQuery} AND cus_id=${req.query.customer_id}`;
      }

      // if (req.query.report_type === 'Monthly' && reportFilterDate) {
      //   query = `${query} AND MONTH(cus_created_at) = Month('${reportFilterDate}') AND YEAR(cus_created_at) = YEAR('${reportFilterDate}')`
      //   orderByQuery = 'ORDER BY cus_created_at DESC, cus_name ASC'
      //   countQuery = `${countQuery} AND MONTH(cus_created_at) = Month('${reportFilterDate}') AND YEAR(cus_created_at) = YEAR('${reportFilterDate}')`
      // } else if (req.query.report_type === 'Yearly' && reportFilterDate) {
      //   query = `${query} AND YEAR(cus_created_at) = YEAR('${reportFilterDate}')`
      //   orderByQuery = 'ORDER BY cus_created_at DESC, cus_name ASC'
      //   countQuery = `${countQuery} AND YEAR(cus_created_at) = YEAR('${reportFilterDate}')`
      // } else if (req.query.report_type === 'Quarterly') {
      //   query = `${query} AND cus_created_at >= DATEADD(quarter, -1, GETDATE()) AND cus_created_at <= GETDATE()`
      //   orderByQuery = 'ORDER BY cus_created_at DESC, cus_name ASC'
      //   countQuery = `${countQuery} AND cus_created_at >= DATEADD(quarter, -1, GETDATE()) AND cus_created_at <= GETDATE()`
      // } else if (startDate && toDate) {
      //   query = `${query} AND cus_created_at >= '${startDate}' AND cus_created_at <= '${toDate}'`
      //   countQuery = `${countQuery} AND cus_created_at >= '${startDate}' AND cus_created_at <= '${toDate}'`
      //   orderByQuery = 'ORDER BY cus_created_at DESC, cus_name ASC'
      // }

      query = `${query} ${orderByQuery} ${paginateQuery}`;

      console.log('>>>>>>>>>>>>>> QUERY ::::::::::: ', query);
      console.log('>>>>>>>>>>>>>> COUNT QUERY ::::: ', countQuery);

      const response = await DBinsertSendResponse(query);
      const totalCount = await DBinsertSendResponse(countQuery);

      const responseData = {
        customers: response,
        count: totalCount[0][''],
        currentPage
      };
      res.status(200).json(responseData);
      return;
    }
  }
  catch (e) {
    console.log(e);
    const responseData = {
      customers: [],
      count: 0,
      currentPage
    };
    res.status(500).json(responseData);
  }
};

exports.getCustomersList = async function (req, res) {
  if (req.query.company_id) {
    const programId = getProgramIdFromReq(req);
    const includeProjectStatus = req.query.include_project_status === 'true';
    const projectStatusColumn = includeProjectStatus
      ? `, CAST(CASE WHEN EXISTS (
          SELECT 1 FROM project
          WHERE pro_customer_id = cus_id
            AND pro_com_id = cus_company_id
            AND pro_is_active = 1
        ) THEN 1 ELSE 0 END AS bit) AS has_active_project`
      : '';
    const query = `select DISTINCT cus_name, cus_id${projectStatusColumn} from customer where cus_company_id=${req.query.company_id} ORDER BY cus_name asc `;
    let response = await DBinsertSendResponse(query);
    response = await filterCustomersByProgram(response, programId);

    const responseData = {
      customers: response
    };
    res.status(200).json(responseData);
    return;
  }

  res.status(500).json({
    message: 'Could not retrieve list of customers for the current company'
  });
};

exports.getCusTables = async function (req, res) {
  // console.log(req)
  const programId = getProgramIdFromReq(req);
  let custList;
  if (req.query.comp_id) {
    custList = await getCustomerList(req.query.comp_id);
  } else if (req.query.com_id) {
    custList = await getCustList(req, res);
  } else {
    custList = await getCustomerSimplePayload(req.query.company_id);
  }
  custList = await filterCustomersByProgram(custList, programId);
  res.json(custList);
};

getCustomerSimplePayload = async (id) => {
  // console.log(id)
  const query = `select cus_id as id, cus_name as customer_name,cus_is_company,DDDID as ddd_id from customer where cus_company_id=${id}`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  return ResultList;
};

exports.getAssignedCustomers = async function (req, res) {
  // console.log(req)
  let custList;
  if (req.query.emp_id) {
    try {
      const query = `SELECT DISTINCT c.cus_id, c.cus_name
            FROM projectEmployeeAssignment pea
            INNER JOIN project p
                ON pea.pea_pro_id = p.pro_id
            INNER JOIN customer c
                ON c.cus_id = p.pro_customer_id
            WHERE pea.pea_emp_id = ${req.query.emp_id} and p.pro_is_active=1 and c.cus_is_active=1 order by c.cus_name`;
      const customerList = await DBinsertSendResponse(query);

      res.status(200).json({
        customers: customerList
      });
    } catch (err) {
      res.status(500).json({
        message: 'An unexpected error occured'
      });
    }
  } else {
    res.status(400).json({
      message: 'Invalid Employee ID'
    });
  }
};

exports.addNewCustomers = async function (req, res) {
  addCustomer(req, res, sendID = false);
};

exports.getCustomerByDDD = async function (req, res) {
  await getcustomerbyddd(req, res);
};

exports.addNewCustomersWithProj = async function (req, res) {
  addCustomerWithProject(req, res);
};

exports.updateCustomers = async function (req, res) {
  updateOneCustomer(req, res, sendID = false);
};

exports.delCustomers = async function (req, res) {
  delOneCustomer(req, res);
};

exports.addOneCustomer = async (req, res) => {
  await addCustomer(req, res, sendID = true);
};

exports.updateCustomer = async (req, res) => {
  updateOneCustomer(req, res, sendID = true);
};

exports.getCustomersForScheduler = async function (req, res) {
  const comp_id = req.query.comp_id;
  if (!comp_id) {
    return res.status(400).json({ message: 'comp_id is required' });
  }
  try {
    const programId = getProgramIdFromReq(req);
    const query = `
      SELECT DISTINCT c.cus_id, c.cus_name, c.cus_status
      FROM customer c
      LEFT JOIN project p ON p.pro_customer_id = c.cus_id AND p.pro_is_active = 1
      WHERE c.cus_company_id = ${comp_id}
        AND ((c.cus_status = 'Active' AND p.pro_id IS NOT NULL) OR c.cus_status = 'Prospect')
      ORDER BY c.cus_name ASC
    `;
    let result = await DBinsertSendResponse(query);
    result = await filterCustomersByProgram(result, programId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getCustomersForScheduler:', error);
    res.status(500).json({ message: 'Failed to retrieve customers for scheduler' });
  }
};

exports.getCustomerSCHData = async (req, res) => {
  const start = performance.now();
  try {
    await getCustomerSCHData(req, res);
    console.log(`/api/fieldworker/customers/SCH GET TIMETAKEN: ${performance.now() - start} MS`);
  } catch (error) {
    console.log(`/api/fieldworker/customers/SCH GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/customers/SCH GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

exports.getCustomerTasks = async (req, res) => {
  try {
    if (!req.query.comp_id || !req.query.customer_id) {
      return res.status(400).json({ message: 'comp_id and customer_id are required' });
    }
    const query = `select * from customer_task ct join dropdowns on taskTypeID = ddID where ct.companyid = ${req.query.comp_id} and customer_id = ${req.query.customer_id}`;
    const resp = await DBSendResponse(query);
    res.json(resp);
  } catch (error) {
    console.log('| ERROR | Bad getCustomerTasks Query');
    console.log('Request Details: ' + req.query);
    console.log('Error' + error);
    res.status(500);
    return;
  }
};

exports.addToCustomerTask = async (req, res) => {
  try {
    const query = `select * from customer_task where companyid = ${req.body.comp_id} and customer_id = ${req.body.customer_id}`;
    const relationships = await DBSendResponse(query);

    let taskData = req.body.taskData.filter((taskType) => {
      return !relationships.some((relation) => relation.taskTypeID === taskType.ddID);
    });

    for (const taskType of taskData) {
      const query = `insert into customer_task (empid, taskTypeID, status, companyid, customer_id) values (${req.body.empid}, ${taskType.ddID}, ${req.body.status}, ${req.body.comp_id}, ${req.body.customer_id}); SELECT SCOPE_IDENTITY();`;
      const relationshipid = await DBinsertSendID(query);
    }
    return res.json({ code: 200, message: 'Inserted Successfully' });
  }
  catch {
    return res.json({ code: 500, message: 'Insert Failed' });
  }
};

exports.deleteFromCustomerTask = async (req, res) => {
  try {
    for (const emp of req.body.taskData) {
      const query = `delete from customer_task where taskTypeID = ${emp.taskTypeID} and customer_id = ${req.body.customer_id} and companyid = ${req.body.comp_id}`;
      const out = await DBUpdate(query);
    }
    return res.json({ code: 500, message: 'Update failed' });
  }
  catch {
    return res.json({ code: 200, message: 'Update Success' });
  }
};

exports.getCustomerDetailsPDF = async (req, res) => {
  try {
    const query = `select * from customer where cus_id = ${req.query.customer_id}`;
    const customerDataResponse = await DBSendResponse(query);
    let customerData = customerDataResponse.length > 0 ? customerDataResponse[0] : {};

    // Create a new PDF document
    const doc = new PDFDocument();

    // Collect the PDF data in a buffer
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);

      // Send the buffer to the client
      res.contentType('application/pdf');
      res.send(pdfBuffer);
    });

    // Encode the customerData to a QR code and add it to the pdf
    const qrCodeData = await QRCode.toDataURL(JSON.stringify({ customer_id: customerData.cus_id, customer_name: customerData.cus_name, company_id: customerData.cus_company_id }));
    const base64Data = qrCodeData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    doc.image(buffer, 15, 15, { fit: [150, 150] });

    // Get the customer's image and add it to the pdf
    try {
      const query = `SELECT * FROM customer_images WHERE customer_id = ${customerData.cus_id}`;
      const response = await DBSendResponse(query);

      if (response && response.length > 0) {
        const customerImage = response[0].image;

        if (customerImage) {
          console.log(customerImage);
          const imageBuffer = Buffer.from(customerImage, 'base64');
          doc.image(imageBuffer, 165, 27, { fit: [125, 125] });
        }
      } else {
        console.log('No image found for this customer');
        // res.status(204).json({ error: 'No image found for this customer' });
        // return;
      }
    } catch (err) {
      console.error(err);
    }

    // Add some text
    doc
      .fontSize(20)
      .text(`${customerData.cus_name}`, 28, 165);

    // Finalize the PDF file
    doc.end();

  } catch (error) {
    console.log('| ERROR | Bad getCustomerDetailsPDF Query');
    console.log('Request Details: ' + req.query);
    console.log('Error' + error);
    res.status(500);
    return;
  }
};

exports.getAssociatedCustomersAndTaskTypes = async (req, res) => {
  const query = `SELECT pro_id, pro_title, pro_manager_id, cus_id, cus_name, DDDID, medicaid_id, 
    (SELECT emp_first_name FROM employee WHERE emp_id = pro_manager_id) as ManagerFirstName, 
    (SELECT emp_last_name FROM employee WHERE emp_id = pro_manager_id) as ManagerLastName,
    (SELECT * FROM projectEmployeeAssignment WHERE pea_pro_id = pro_id AND pea_emp_id = ${req.query.empID} AND pea_is_active = 'true' for JSON PATH) as projEmpAssignmentDets,
    (SELECT * FROM customer_task ct JOIN dropdowns ON taskTypeID = ddID WHERE ct.companyid = ${req.query.compID} AND customer_id = cus_id for JSON PATH) as cusTaskTypes
  FROM project
  JOIN customer ON cus_id = pro_customer_id
  WHERE pro_com_id = ${req.query.compID} AND pro_is_active = 'True'`;

  let caseLoadData = await DBSendResponse(query);

  caseLoadData = caseLoadData.map((caseData) => {
    caseData.cusTaskTypes = JSON.parse(caseData.cusTaskTypes);
    caseData.projEmpAssignmentDets = JSON.parse(caseData.projEmpAssignmentDets);
    return caseData;
  });

  if (req.query.empType !== 'Admin') {
    caseLoadData = caseLoadData.filter((caseData) => caseData.projEmpAssignmentDets);
  }

  res.json(caseLoadData);
};

exports.getAssociatedCustomersAndTaskNotes = async (req, res) => {
  // Support both date range (start/end) and month parameters for backward compatibility
  let startDate, endDate;
  if (req.query.start && req.query.end) {
    // New date range functionality
    startDate = moment(req.query.start).format('MM/DD/YYYY');
    endDate = moment(req.query.end).format('MM/DD/YYYY');
  } else if (req.query.month) {
    // Old month functionality
    startDate = moment(req.query.month).startOf('month').format('MM/DD/YYYY');
    endDate = moment(req.query.month).endOf('month').format('MM/DD/YYYY');
  } else {
    // Default to current month if no parameters provided
    startDate = moment().startOf('month').format('MM/DD/YYYY');
    endDate = moment().endOf('month').format('MM/DD/YYYY');
  }

  const program_id = req.query.program_id ? JSON.parse(req.query.program_id) : null;
  const oloc_id = req.query.oloc_id ? JSON.parse(req.query.oloc_id) : null;

  const programFilter = program_id ? ` AND pro_program_id = ${program_id}` : '';
  // Office location is a task attribute, so filtering by it also drops rows whose task is
  // absent (notes with no task in range) — those rows have no office to match against.
  const officeFilter = oloc_id ? ` AND tas_oloc_id = ${oloc_id}` : '';

  const query = `SELECT pro_id, pro_title, cus_id, cus_name, comment_id, comment_text, proj_id, task_id, tas_title, tas_is_active, empLocdate, e.emp_id, emp_first_name, emp_last_name,
    FORMAT(DATEDIFF(minute, empLocdate, checkoutEmpDate) / 60, '00') + ':' + FORMAT(DATEDIFF(minute, empLocdate, checkoutEmpDate) % 60, '00') as taskDuration,
    (SELECT * FROM projectEmployeeAssignment WHERE pea_pro_id = pro_id AND pea_emp_id = ${req.query.empID} AND pea_is_active = 'true' for JSON PATH) as projEmpAssignmentDets
  FROM project
  JOIN customer ON cus_id = pro_customer_id
  LEFT JOIN comments ON customer_id = cus_id AND created_at >= '${startDate}' and created_at <= '${endDate}'
	LEFT JOIN task ON tas_id = task_id AND tas_pro_id = pro_id AND tas_is_active != 2
	LEFT JOIN empLocate ON taskId = tas_id
  LEFT JOIN employee e ON e.emp_id = comments.emp_id
  WHERE pro_com_id = ${req.query.compID} AND pro_is_active = 'True'${programFilter}${officeFilter}`;

  let customerNotesData = await DBSendResponse(query);

  customerNotesData = customerNotesData.map((caseData) => {
    caseData.projEmpAssignmentDets = JSON.parse(caseData.projEmpAssignmentDets);
    return caseData;
  });

  if (req.query.empType !== 'Admin') {
    customerNotesData = customerNotesData.filter((caseData) => caseData.projEmpAssignmentDets);
  }

  res.json(customerNotesData);
};

async function getcustomerbyddd(req, res) {
  const query = `select cus_id from customer where DDDID = ${req.query.ddd}`;
  let out;
  out = await DBSendResponse(query);
  res.json(out);
}

async function getCustList(req, res) {
  // If cust_id is specified, run a targeted query for that specific customer
  if (req.query.cust_id) {
    const query = `select *,
      (select con_id,con_first_name,con_last_name,con_phone,con_designation,con_status,con_contact_type,con_first_contact_date,con_last_contact_date from contact where (con_customer_id=cus_id or con_customer_id is NULL) and con_id in (select cont_id as con_id from ProjectContact,project where pro_id = proj_id and con_id=con_id and pro_customer_id = cus_id) 
      for JSON PATH) as contacts,
      (select pro_id,pro_title,pro_is_active,pro_starts_on,pro_ends_on,pro_description from project where pro_customer_id = cus_id for JSON PATH) as projects,
      (select distinct ploc_loc_id as loc_id from project,projectLocation where pro_customer_id = cus_id and ploc_pro_id = pro_id for JSON PATH) as locations 
      from customer where cus_company_id=${req.query.com_id} and cus_id=${req.query.cust_id}`;
    
    let ResultList = await DBinsertSendResponse(query);
    let custList = ResultList.map((cusItem) => {
      cusItem.projects = JSON.parse(cusItem.projects);
      cusItem.locations = JSON.parse(cusItem.locations);
      cusItem.contacts = JSON.parse(cusItem.contacts);
      return cusItem;
    });
    
    return custList;
  }

  // Otherwise, fetch all customers and filter
  const query = `select *,
    (select con_id,con_first_name,con_last_name,con_phone,con_designation,con_status,con_contact_type,con_first_contact_date,con_last_contact_date from contact where (con_customer_id=cus_id or con_customer_id is NULL) and con_id in (select cont_id as con_id from ProjectContact,project where pro_id = proj_id and con_id=con_id and pro_customer_id = cus_id) 
	for JSON PATH) as contacts,
	(select pro_id,pro_title,pro_is_active,pro_starts_on,pro_ends_on,pro_description from project where pro_customer_id = cus_id for JSON PATH) as projects,
	(select distinct ploc_loc_id as loc_id from project,projectLocation where pro_customer_id = cus_id and ploc_pro_id = pro_id for JSON PATH) as locations 
	from customer where cus_company_id=${req.query.com_id}`;
  let ResultList = [];
  ResultList = await DBinsertSendResponse(query);
  let custList = ResultList.map((cusItem) => {
    cusItem.projects = JSON.parse(cusItem.projects);
    cusItem.locations = JSON.parse(cusItem.locations);
    cusItem.contacts = JSON.parse(cusItem.contacts);
    return cusItem;
  });

  if (req.query.loc_id) {
    custList = custList.filter((cust) => !!cust.locations && !!cust.locations.find((loc) => (loc.loc_id === +req.query.loc_id)));
  } else if (req.query.con_id) {
    custList = custList.filter((cust) => !!cust.contacts && !!cust.contacts.find((con) => (con.con_id === +req.query.con_id)));
  } else if (req.query.pro_id) {
    custList = custList.filter((cust) => !!cust.projects && !!cust.projects.find((pro) => (pro.pro_id === +req.query.pro_id)));
  }

  if (!!req.query.lastN && custList.length > +req.query.lastN) {
    custList = custList.slice(Math.max(custList.length - +req.query.lastN, 0));
  }
  
  return custList;
}

async function delOneCustomer(req, res) {
  const booleanValue = req.body.bval;
  const id = req.body.id;
  const query = `UPDATE customer SET cus_is_active = '${booleanValue}' WHERE cus_id = ${id}`;
  const out = await DBUpdate(res, query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}
async function updateOneCustomer(req, res) {
  console.log(req.body);
  // GET PREV_ADDLIST
  const prevCustAddList = `SELECT cus_address from customer WHERE cus_id= ${req.body.cus_id}`;

  const custAddListRes = await DBSendResponse(prevCustAddList);
  const prevCustList = custAddListRes[0].cus_address.split(':');
  console.log(prevCustList);
  const loc_IdList = [];
  // find all the loc_id for the addresses in cus_addr
  let preAddList = await Promise.all(prevCustList.map(async (add) => {
    try {
      console.log(add);
      const addArr = validators.getAddress(add);
      for (const key in addArr) {
        addArr[key] = addArr[key].normalize('NFC');
      }
      // add.split(',')
      console.log('Inside update splitting address by comma');
      console.log(addArr);
      const findPrevLocIDQuery = `SELECT loc_id from location WHERE loc_addr_line1 = '${addArr.address_line1}' AND loc_addr_line2 = '${addArr.address_line2}' AND loc_city = '${addArr.city}' AND loc_state = '${addArr.state}' AND loc_zip = '${addArr.zip}' AND (loc_is_active='true' OR loc_is_active is NULL) AND loc_company_id='${req.body.comp_id}'`;
      console.log(findPrevLocIDQuery);
      const prevLocIdRes = await DBSendResponse(findPrevLocIDQuery);
      if (!prevLocIdRes || !prevLocIdRes[0]) {
        return null;
      }
      loc_IdList.push(prevLocIdRes[0].loc_id);
      const addObj = { addId: prevLocIdRes[0].loc_id, address_line_1: addArr[0], address_line_2: addArr[1], city: addArr[2], state: addArr[3], zip: addArr[4] };
      return addObj;
    } catch (err) {
      console.log('| ERROR | Error occured when trying to generate preAddList:');
      console.log(err);
    }
  })
  );
  preAddList = preAddList.filter((add) => add !== null && add !== undefined);
  console.log(preAddList);
  console.log(loc_IdList);
  const tasks = {};
  // Query for finding tasks related to location Id - finding all tasks that are associated to the above locations
  await Promise.all(loc_IdList.map(async (id) => {
    const taskQuery = `Select tas_id from task where tas_loc_id=${id}`;
    const restTaskforLoc = await DBSendResponse(taskQuery);
    tasks[id] = restTaskforLoc;
    // console.log(restTaskforLoc)
    return restTaskforLoc;
  }));
  console.log(tasks);

  // convert all the addresses from the input addlist into a single string
  const locations = req.body.addList.map((add) => {
    return `${(add.address_line_1 ?? '').normalize('NFC')},` +
         `${(add.address_line_2 ?? '').normalize('NFC')},` +
         `${add.city ?? ''},` +
         `${add.state ?? ''},` +
         `${add.zip ?? ''}`;
  });
  // console.log(locations)// .join(":")

  // if the current locations length == previous address lists length
  const taskOrder = [];
  if (preAddList.length === req.body.addList.length) {
    locations.forEach((add, i) => {
      const foundIndex = prevCustList.indexOf(locations[i]);
      if (foundIndex === -1) {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[i], new_loc_id: loc_IdList[i] });
      } else {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[foundIndex], new_loc_id: loc_IdList[i] });
      }
    });
    prevCustList.forEach((add, i) => {
      const foundIndex = locations.indexOf(prevCustList[i]);
      if (foundIndex === -1) {
        taskOrder[i] = { ...taskOrder[i], new_loc_id: loc_IdList[i] };
      } else {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: loc_IdList[foundIndex] };
      }
    });
    console.log(taskOrder);
  } else if (preAddList.length > req.body.addList.length) {
    prevCustList.forEach((add, i) => {
      const foundIndex = locations.indexOf(prevCustList[i]);
      if (foundIndex === -1) {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: 'No trasfer Needed', new_loc_id: loc_IdList[i] });
      } else {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[i], new_loc_id: loc_IdList[i] });
      }
    });
    locations.forEach((add, i) => {
      const foundIndex = prevCustList.indexOf(locations[i]);
      if (foundIndex === -1) {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: 'No trasfer Needed', new_loc_id: loc_IdList[i] };
      } else {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: loc_IdList[foundIndex] };
      }
    });
    console.log(taskOrder);
  } else {
    locations.forEach((add, i) => {
      const foundIndex = prevCustList.indexOf(locations[i]);
      if (foundIndex === -1) {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: 'No trasfer Needed', new_loc_id: 'New ID' });
      } else {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[foundIndex], new_loc_id: (!loc_IdList[i] ? 'New ID' : loc_IdList[i]) });
      }
    });
    prevCustList.forEach((add, i) => {
      const foundIndex = locations.indexOf(prevCustList[i]);
      if (foundIndex === -1) {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: loc_IdList[i], new_loc_id: loc_IdList[i] };
      } else {
        taskOrder[i] = { ...taskOrder[i], new_loc_id: loc_IdList[i] };
      }
    });
    console.log(taskOrder);
  }

  const finalTranferOfTasks = await Promise.all(taskOrder.map(async (taskTransfer) => {
    let TaskRes;
    if (taskTransfer.tranTask_loc_id !== taskTransfer.new_loc_id && taskTransfer.tranTask_loc_id !== 'No trasfer Needed' && tasks[taskTransfer.tranTask_loc_id].length !== 0) {
      const taskTransterRes = await Promise.all(tasks[taskTransfer.tranTask_loc_id].map(async (task) => {
        const taskTransQuery = `UPDATE task SET tas_loc_id=${taskTransfer.new_loc_id} WHERE tas_id=${task.tas_id}`;
        console.log(taskTransQuery);
        const taskUpdateRes = await DBUpdate(taskTransQuery);
        if (taskUpdateRes === 0) {
          res.json({ code: 500, message: 'Error in Task Update' });
        }
        return { tid: task.tas_id, tloc: taskTransfer.new_loc_id, status: 'Updated' };
      }));
      TaskRes = { loc_id: taskTransfer.new_loc_id, tasks: taskTransterRes };
    } else {
      // console.log(tasks[taskTransfer.tranTask_loc_id])
      TaskRes = { loc_id: taskTransfer.new_loc_id, tasks: (!tasks[taskTransfer.new_loc_id]) ? 'No trasfer Needed' : tasks[taskTransfer.new_loc_id] };
      // finalTranferOfTasks[taskTransfer.new_loc_id] = tasks[taskTransfer.new_loc_id]
    }
    return TaskRes;
  }));

  console.log(finalTranferOfTasks);

  let name = req.body.cus_name;
  name = name.normalize('NFC');
  const query = `UPDATE customer 
    SET 
      cus_updated_at=CURRENT_TIMESTAMP,
      cus_name='${parseSQLText(name, 50)}',
      cus_first_name=${req.body.first_name ? `'${parseSQLText(req.body.first_name, 50)}'` : null},
      cus_last_name=${req.body.last_name ? `'${parseSQLText(req.body.last_name, 50)}'` : null},
      gender='${req.body.gender}',
      dob=${moment(req.body.dob).isValid() ? `'${req.body.dob}'` : null},
      cus_address='${parseSQLText(locations.join(':'), 300)}',
      cus_email=${req.body.email ? `'${parseSQLText(req.body.email.normalize('NFC'), 255)}'` : null},
      cus_local_id=${req.body.cus_local_id ? `'${parseSQLText(req.body.cus_local_id, 255)}'` : null},
      cus_phone='${parseSQLText(req.body.phonList, 100)}',
      cus_acquired_date=${moment(req.body.acquired_date).isValid() ? `'${req.body.acquired_date}'` : null},
      cus_status='${req.body.status}',
      cus_type='${req.body.type}',
      medicaid_id=${req.body.medicaid_id ? `'${parseSQLText(req.body.medicaid_id, 15)}'` : null},
      medicaid_eligible=${req.body.medicaid_eligible !== null ? Number(req.body.medicaid_eligible) : null},
      sign_page_date=${moment(req.body.sign_page_date).isValid() ? `'${req.body.sign_page_date}'` : null},
      last_plan_approval_date=${moment(req.body.last_plan_approval_date).isValid() ? `'${req.body.last_plan_approval_date}'` : null},
      last_assess_date=${moment(req.body.last_assess_date).isValid() ? `'${req.body.last_assess_date}'` : null},
      renewal_date=${moment(req.body.renewal_date).isValid() ? `'${req.body.renewal_date}'` : null},
      DDDID='${parseSQLText(req.body.DDDID, 10)}',
      DDD_tier=${req.body.DDD_tier ? `'${parseSQLText(req.body.DDD_tier, 10)}'` : null},
      PrimaryDiagnosisCode=${req.body.diagnose_code ? `'${parseSQLText(req.body.diagnose_code, 30)}'` : null},
      SecondaryDiagnosisCode=${req.body.secondary_diagnose_code ? `'${parseSQLText(req.body.secondary_diagnose_code, 20)}'` : null},
      func_criteria_met=${req.body.func_criteria_met !== null ? Number(req.body.func_criteria_met) : null},
      waiver_program=${req.body.waiver_program ? `'${parseSQLText(req.body.waiver_program, 50)}'` : null},
      NJCATSelfcare=${req.body.NJCATSelfcare},
      NJCATBehavioral=${req.body.NJCATBehavioral},
      NJCATMedical=${req.body.NJCATMedical},
      NJCATFCA=${req.body.NJCATFCA ? `'${parseSQLText(req.body.NJCATFCA, 10)}'` : null},
      MedicaidEndDate=${moment(req.body.MedicaidEndDate).isValid() ? '\'' + req.body.MedicaidEndDate + '\'' : 'NULL'},
      AgencyAssignDate=${moment(req.body.AgencyAssignDate).isValid() ? '\'' + req.body.AgencyAssignDate + '\'' : 'NULL'},
      County=${req.body.County ? `'${parseSQLText(req.body.County, 50)}'` : null},
      Race=${req.body.Race ? `'${parseSQLText(req.body.Race, 50)}'` : null},
      Ethnicity=${req.body.Ethnicity ? `'${parseSQLText(req.body.Ethnicity, 50)}'` : null},
      TransferOutReason=${req.body.status === 'Dormant' ? `'${parseSQLText(req.body.TransferOutReason, 50)}'` : null},
      TransferOutDate=${req.body.status === 'Dormant' && moment(req.body.TransferOutDate).isValid() ? `'${req.body.TransferOutDate}'` : null},
      mailing_detail=${req.body.mailing_detail ? `'${parseSQLText(req.body.mailing_detail, 128)}'` : null},
      place01char=${req.body.place01char ? '\'' + generateSQLText(req.body.place01char) + '\'' : 'NULL'},
      place02char=${req.body.place02char ? '\'' + generateSQLText(req.body.place02char) + '\'' : 'NULL'},
      place03char=${req.body.place03char ? '\'' + generateSQLText(req.body.place03char) + '\'' : 'NULL'},
      place04char=${req.body.place04char ? '\'' + generateSQLText(req.body.place04char) + '\'' : 'NULL'},
      place05char=${req.body.place05char ? '\'' + generateSQLText(req.body.place05char) + '\'' : 'NULL'},
      place06char=${req.body.place06char ? '\'' + generateSQLText(req.body.place06char) + '\'' : 'NULL'},
      place07char=${req.body.place07char ? '\'' + generateSQLText(req.body.place07char) + '\'' : 'NULL'},
      place08char=${req.body.place08char ? '\'' + generateSQLText(req.body.place08char) + '\'' : 'NULL'},
      place09date=${moment(req.body.place09date).isValid() ? '\'' + req.body.place09date + '\'' : 'NULL'},
      place10date=${moment(req.body.place10date).isValid() ? '\'' + req.body.place10date + '\'' : 'NULL'},
      place11date=${moment(req.body.place11date).isValid() ? '\'' + req.body.place11date + '\'' : 'NULL'},
      place12date=${moment(req.body.place12date).isValid() ? '\'' + req.body.place12date + '\'' : 'NULL'},
      place13number=${req.body.place13number ? req.body.place13number : 'NULL'},
      place14number=${req.body.place14number ? req.body.place14number : 'NULL'},
      place15number=${req.body.place15number ? req.body.place15number : 'NULL'},
      place16number=${req.body.place16number ? req.body.place16number : 'NULL'},
      HasPet=${req.body.HasPet !== null && req.body.HasPet !== undefined ? Number(req.body.HasPet) : 'NULL'},
      ProviderGenderPreference=${req.body.ProviderGenderPreference ? `'${parseSQLText(req.body.ProviderGenderPreference, 20)}'` : null},
      LanguagePreference=${req.body.LanguagePreference ? `'${parseSQLText(req.body.LanguagePreference, 50)}'` : null},
      PreferRepeatProviders=${req.body.PreferRepeatProviders !== null && req.body.PreferRepeatProviders !== undefined ? Number(req.body.PreferRepeatProviders) : 'NULL'},
      DriverLicenseNumber=${req.body.DriverLicenseNumber ? `'${parseSQLText(req.body.DriverLicenseNumber, 50)}'` : null},
      DLExpiryDate=${moment(req.body.DLExpiryDate).isValid() ? '\'' + req.body.DLExpiryDate + '\'' : 'NULL'},
      DLIssueDate=${moment(req.body.DLIssueDate).isValid() ? '\'' + req.body.DLIssueDate + '\'' : 'NULL'},
      DLIssueState=${req.body.DLIssueState ? `'${parseSQLText(req.body.DLIssueState, 2)}'` : null}
    WHERE cus_id = ${req.body.cus_id}`;
  const out = await DBUpdate(query);

  if (req.body.status === 'Dormant' && moment(req.body.TransferOutDate).isValid()) {
    const projQuery = `UPDATE project
                        SET pro_ends_on = '${req.body.TransferOutDate}'
                       WHERE pro_customer_id = ${req.body.cus_id} and pro_is_active = 1`;

    const projOut = await DBUpdate(projQuery);
  }

  if (out === 0) {
    // console.log("WTF")
    res.json({ code: 500, message: 'Customer Update failed' });
  } else {
    // CHECK FOR DIFF CASES AFTER UPDATE ON CUSTOMER TABLE
    // CASE 1 - prev list is == to current list length
    if (preAddList.length === req.body.addList.length) {
      const checkUpdtRes = await Promise.all(req.body.addList.map(async (add, index) => {
        if (!add.loc_lat) { add.loc_lat = '0'; }
        if (!add.loc_lon) { add.loc_lon = '0'; }
        const updateRes = await updateOneLocation(req, add, preAddList[index].addId);
        if (updateRes.code === 500) {
          // console.log(updateRes.message)
          res.json({ code: updateRes.code, message: updateRes.message });
        }
        return { loc_id: preAddList[index].addId, status: updateRes.code };
      }));
      console.log('Update Results For CASE 1:', checkUpdtRes);

      let cusName = req.body.cus_name, empName = req.body.empName, empId = req.body.empId;
      if (empId && empName && cusName && req.body.comp_id && req.body.cus_id) {
        analytics.track({
          userId: String(empId),
          event: 'Customer updated',
          context: {
            groupId: String(req.body.comp_id),
          },
          properties: {
            customerName: cusName,
            updatedBy: empName,
            companyId: String(req.body.comp_id),
            customerId: String(req.body.cus_id)
          }
        });
        console.log('logged to segment successfully');
      }
      if (sendID) {
        return { code: 200, id: req.body.cus_id, message: 'Update Success' };
      } else { res.json({ code: 200, id: req.body.cus_id, updated: checkUpdtRes, message: 'Update Success' }); }
    }
    // CASE 2 prev list length <current list length
    else if (preAddList.length < req.body.addList.length) {
      const checkUpdtRes = await Promise.all(req.body.addList.map(async (add, index) => {
        const ResObj = {};
        if (index > preAddList.length - 1) {
          // ADD LOC TO LOCATION
          const addLocQuery = `
            insert into location(
              loc_addr_line1,
              loc_addr_line2,
              loc_city,
              loc_state,
              loc_zip,
              loc_lat,
              loc_lon,
              loc_type,
              loc_status,
              loc_county,
              loc_association_date,
              loc_phone_number,
              loc_company_id,
              loc_is_active
            )
            values (
              '${((add.address_line_1 ?? '').replaceAll('\'', '\'\'')).normalize('NFC')}',
              '${((add.address_line_2 ?? '').replaceAll('\'', '\'\'')).normalize('NFC')}',
              '${((add.city ?? '').replaceAll('\'', '\'\'')).normalize('NFC')}',
              '${(add.state ?? '').normalize('NFC')}',
              '${add.zip ?? ''}',
              ${add.latitude ?? 'NULL'},
              ${add.longitude ?? 'NULL'},
              'Customer Location',
              'Personal',
              'United States',
              GETDATE(),
              '${(req.body.phonList?.split(',')[0] ?? '')}',
              ${req.body.comp_id ?? 'NULL'},
              'true'
            );
            SELECT SCOPE_IDENTITY();
          `;

          // console.log(addLocQuery)
          const addRes = await DBinsertSendID(addLocQuery);
          if (!addRes) {
            res.json({ code: 500, message: 'Failed To add Adress' });
          } else {
            // ADD REF TO PLOC TABLE
            const addPlocQuery = `insert into projectLocation(ploc_pro_id,ploc_loc_id) values(${req.body.proId},${addRes}); SELECT SCOPE_IDENTITY();`;
            // console.log(addPlocQuery)
            const PlocRes = await DBinsertSendID(addPlocQuery);
            if (!PlocRes) {
              res.json({ code: 500, message: 'Failed to assign Location to Project' });
            }
            ResObj.loc_id = addRes;
            ResObj.status = 200;
            ResObj.message = 'ADDED';
          }
        } else {
          // UPDATE LOC
          const updateRes = await updateOneLocation(req, add, preAddList[index].addId);
          if (updateRes.code === 500) {
            res.json({ code: updateRes.code, message: updateRes.message });
          }
          ResObj.loc_id = preAddList[index].addId;
          ResObj.status = updateRes.code;
          ResObj.message = 'UPDATED';
        }
        return ResObj;
      }));
      console.log('Update Results For CASE 2:', checkUpdtRes);
      let cusName = req.body.cus_name, empName = req.body.empName, empId = req.body.empId;
      if (empId && empName && cusName && req.body.comp_id && req.body.cus_id) {
        analytics.track({
          userId: String(empId),
          event: 'Customer updated',
          context: {
            groupId: String(req.body.comp_id),
          },
          properties: {
            customerName: cusName,
            updatedBy: empName,
            companyId: String(req.body.comp_id),
            customerId: String(req.body.cus_id)
          }
        });
        console.log('logged to segment successfully');
      }
      if (sendID) {
        return { code: 200, id: req.body.cus_id, message: 'Update Success' };
      } else { res.json({ code: 200, id: req.body.cus_id, updated: checkUpdtRes, message: 'Update Success' }); }
    }
    // CASE 3 - when an address is deleted from the cus_address ie, prev list > the current list length
    else {
      const checkUpdtRes = await Promise.all(preAddList.map(async (add, index) => {
        const ResObj = {};
        if (index > req.body.addList.length - 1) {
          // DEL REF TO PLOC TABLE
          const delPlocQuery = `DELETE FROM projectLocation WHERE ploc_loc_id=${add.addId}`;
          // console.log(delPlocQuery)
          const PlocDelRes = await DBUpdate(delPlocQuery);
          if (PlocDelRes === 0) {
            res.json({ code: 500, message: 'Failed To delete ref Adress' });
          } else {
            // DEL LOC TO LOCATION
            const delLocQuery = `UPDATE location SET loc_is_active='false' WHERE loc_id=${add.addId}`;
            // console.log(delLocQuery)
            const LocDelRes = await DBUpdate(delLocQuery);
            if (LocDelRes === 0) {
              res.json({ code: 500, message: 'Failed to delete Location' });
            }
            ResObj.loc_id = add.addId;
            ResObj.status = 200;
            ResObj.message = 'DELETED';
          }
        } else {
          // UPDATE LOC
          const updateRes = await updateOneLocation(req, req.body.addList[index], add.addId);
          if (updateRes.code === 500) {
            res.json({ code: updateRes.code, message: updateRes.message });
          }
          ResObj.loc_id = add.addId;
          ResObj.status = updateRes.code;
          ResObj.message = 'UPDATED';
        }
        return ResObj;
      }));
      console.log('Update Results For CASE 3:', checkUpdtRes);
      let cusName = req.body.cus_name, empName = req.body.empName, empId = req.body.empId, empEmail = req.body.empEmail;
      if (empId && empName && cusName && req.body.comp_id && req.body.cus_id) {
        analytics.track({
          userId: String(empId),
          event: 'Customer updated',
          context: {
            groupId: String(req.body.comp_id),
          },
          properties: {
            customerName: cusName,
            updatedBy: empName,
            companyId: String(req.body.comp_id),
            customerId: String(req.body.cus_id)
          }
        });
        console.log('logged to segment successfully');
      }
      if (sendID) {
        return { code: 200, id: req.body.cus_id, message: 'Update Success' };
      } else { res.json({ code: 200, id: req.body.cus_id, updated: checkUpdtRes, message: 'Update Success' }); }
    }
  }
}

async function updateOneLocation(req, address, updtLocId) {
  const query = `UPDATE location 
				SET 
					loc_addr_line1='${address.address_line_1}',
					loc_addr_line2='${address.address_line_2}',
					loc_city='${address.city}',
					loc_state='${address.state}',
					loc_zip='${address.zip}',
					loc_lat=${(address.latitude ? address.latitude : '0')},
					loc_lon=${(address.longitude ? address.longitude : '0')},
					loc_is_active='true',
					loc_phone_number='${req.body.phonList.split(',')[0]}'
				WHERE loc_id = ${updtLocId}`;
  console.log(query);
  const out = await DBUpdate(query);
  if (out == 0) {
    return ({ code: 500, message: 'Update failed' });
  } else {
    return ({ code: 200, message: 'Update Success' });
  }
}

async function getBYddd(ddd_id, com_id) {
  const query = `select * from customer where cus_company_id = ${com_id} and DDDID = '${ddd_id}'`;
  const res = await DBSendResponse(query);
  return res;
}

async function addCustomer(req, res) {
  console.log('Adding Customer', req.body);
  
  // let sendID = !!sendID
  let valid = [];
  if(req.body.ddd_id || req.body.DDDID) {
    valid =  await getBYddd(req.body.ddd_id || req.body.DDDID, req.body.company_id) || [];
  }
  // console.log(valid)
  if (valid.length !== 0) {
    res.status(409).json({ code: 409, message: 'Customer Insert Failed. DDD_ID Already Exist' });
  } else {
    let name = req.body.name;
    name = name.normalize('NFC');
    const locations = req.body.address.map((add) => { return `${(add.address_line_1 ?? '').normalize('NFC')},${add.address_line_2 ? add.address_line_2.normalize('NFC') : ''},${add.city},${add.state},${add.zip}`; }).join(':');

    // Date sanitization helper: strict parse allowed formats; return SQL token (quoted date or NULL)
    const parseDateToken = (val) => {
      if (!val) return 'NULL';
      const m = moment(val, [moment.ISO_8601, 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'MM/DD/YYYY'], true);
      return m.isValid() ? `'${m.format('YYYY-MM-DD')}'` : 'NULL';
    };

    const acquiredDateToken = parseDateToken(req.body.acquired_date);
    const dobToken = parseDateToken(req.body.dob);
    const lastAssessToken = parseDateToken(req.body.last_assess_date);
    const lastPlanApprovalToken = parseDateToken(req.body.last_plan_approval_date); // fixed wrong field reference
    const signPageToken = parseDateToken(req.body.sign_page_date);
    const medicaidEndToken = parseDateToken(req.body.medicaid_end_date);
    const MedicaidEndDateToken = parseDateToken(req.body.MedicaidEndDate);
    const agencyAssignToken = parseDateToken(req.body.AgencyAssignDate);
    const place09Token = parseDateToken(req.body.place09date);
    const place10Token = parseDateToken(req.body.place10date);
    const place11Token = parseDateToken(req.body.place11date);
    const place12Token = parseDateToken(req.body.place12date);

    // Age sanitization: cus_age is INT. Extracted age may arrive as "54 yrs.", "31", etc.,
    // so strip non-digits and fall back to NULL when no number is present.
    const ageVal = parseInt(String(req.body.age ?? '').replace(/[^0-9]/g, ''), 10);
    const ageToken = Number.isFinite(ageVal) ? ageVal : 'NULL';

    const query = `insert into customer (cus_name, cus_first_name, cus_last_name, cus_address, cus_phone, cus_acquired_date, cus_status, cus_type, cus_created_at, cus_company_id, cus_is_company, cus_is_active, DDDID, DDD_tier, waiver_program, cus_age, dob, cus_email,cus_local_id, func_criteria_met, gender, last_assess_date, last_plan_approval_date, sign_page_date, medicaid_eligible, renewal_date, medicaid_id, PrimaryDiagnosisCode, SecondaryDiagnosisCode, NJCATSelfcare, NJCATBehavioral, NJCATMedical, NJCATFCA, MedicaidEndDate, AgencyAssignDate, County, Race, Ethnicity, place01char, place02char, place03char, place04char, place05char, place06char, place07char, place08char, place09date, place10date, place11date, place12date, place13number, place14number, place15number, place16number)
    values (
      '${parseSQLText(name, 50) || ''}',
      ${req.body.first_name ? `'${parseSQLText(req.body.first_name, 50)}'` : 'NULL'},
      ${req.body.last_name ? `'${parseSQLText(req.body.last_name, 50)}'` : 'NULL'},
      '${parseSQLText(locations, 300) || ''}',
      '${req.body.phone ? parseSQLText(req.body.phone, 100) : ''}',
      ${acquiredDateToken},
      '${req.body.status ? req.body.status : ''}',
      '${req.body.customer_type ? req.body.customer_type : ''}',
      CURRENT_TIMESTAMP,
      ${req.body.company_id ? req.body.company_id : ''},
      '${req.body.is_company ? req.body.is_company : ''}',
      'True',
      '${req.body.DDDID ? parseSQLText(req.body.DDDID, 10) : ''}',
      '${req.body.DDD_tier ? parseSQLText(req.body.DDD_tier, 10) : ''}',
      '${req.body.waiver_prgm ? parseSQLText(req.body.waiver_prgm, 50) : ''}',
      ${ageToken},
      ${dobToken},
      '${req.body.email ? parseSQLText(req.body.email.normalize('NFC'), 255) : ''}',
      '${req.body.cus_local_id ? parseSQLText(req.body.cus_local_id, 255) : ''}',
      '${req.body.func_criteria_met ? req.body.func_criteria_met : ''}',
      '${req.body.gender ? req.body.gender : ''}',
      ${lastAssessToken},
      ${lastPlanApprovalToken},
      ${signPageToken},
      '${req.body.medicaid_eligible ? req.body.medicaid_eligible : ''}',
      ${medicaidEndToken},
      '${req.body.medicaid_id ? parseSQLText(req.body.medicaid_id, 15) : ''}',
      '${req.body.diagnose_code ? parseSQLText(req.body.diagnose_code, 30) : ''}',
      '${req.body.secondary_diagnose_code ? parseSQLText(req.body.secondary_diagnose_code, 20) : ''}',
      '${req.body.NJCATSelfcare ? req.body.NJCATSelfcare : ''}',
      '${req.body.NJCATBehavioral ? req.body.NJCATBehavioral : ''}',
      '${req.body.NJCATMedical ? req.body.NJCATMedical : ''}',
      '${req.body.NJCATFCA ? parseSQLText(req.body.NJCATFCA, 10) : ''}',
      ${MedicaidEndDateToken},
      ${agencyAssignToken},
      '${req.body.County ? parseSQLText(req.body.County, 50) : ''}',
      '${req.body.Race ? parseSQLText(req.body.Race, 50) : ''}',
      '${req.body.Ethnicity ? parseSQLText(req.body.Ethnicity, 50) : ''}',
      ${req.body.place01char ? '\'' + generateSQLText(req.body.place01char) + '\'' : 'NULL'},
      ${req.body.place02char ? '\'' + generateSQLText(req.body.place02char) + '\'' : 'NULL'},
      ${req.body.place03char ? '\'' + generateSQLText(req.body.place03char) + '\'' : 'NULL'},
      ${req.body.place04char ? '\'' + generateSQLText(req.body.place04char) + '\'' : 'NULL'},
      ${req.body.place05char ? '\'' + generateSQLText(req.body.place05char) + '\'' : 'NULL'},
      ${req.body.place06char ? '\'' + generateSQLText(req.body.place06char) + '\'' : 'NULL'},
      ${req.body.place07char ? '\'' + generateSQLText(req.body.place07char) + '\'' : 'NULL'},
      ${req.body.place08char ? '\'' + generateSQLText(req.body.place08char) + '\'' : 'NULL'},
      ${place09Token},
      ${place10Token},
      ${place11Token},
      ${place12Token},
      ${req.body.place13number ? '\'' + parseSQLText(req.body.place13number, 20) + '\'' : 'NULL'},
      ${req.body.place14number ? '\'' + parseSQLText(req.body.place14number, 20) + '\'' : 'NULL'},
      ${req.body.place15number ? '\'' + parseSQLText(req.body.place15number, 20) + '\'' : 'NULL'},
      ${req.body.place16number ? '\'' + parseSQLText(req.body.place16number, 20) + '\'' : 'NULL'}
    ); SELECT SCOPE_IDENTITY();`;
    console.log(query);
    const cus_id = await DBinsertSendID(query);
    console.log('cus_id');
    console.log(cus_id);
    if (!cus_id) { return res.status(500).json({ code: 500, message: 'Insert Failed for Customer' }); }
    else {
      let cusName = req.body.name, empName = req.body.empName, empId = req.body.empId;
      if (empId && cusName && empName && req.body.company_id && cus_id) {
        analytics.track({
          userId: String(empId),
          event: 'Customer added',
          context: {
            groupId: String(req.body.company_id),
          },
          properties: {
            customerName: cusName,
            addedBy: empName,
            companyId: String(req.body.company_id),
            customerId: String(cus_id)
          }
        });
        console.log('logged to segment successfully');
      }
    }
    const locArrId = [];
    for (let i = 0; i < req.body.address.length; i++) {
      const loc_id = await addlocation(req, res, sendId = true, address = req.body.address[i]);
      if (!loc_id) { return res.json({ code: 500, message: 'Insert Failed For Location' }); } else { locArrId.push(loc_id); }
    }

    console.log('locArrId');
    console.log(locArrId);

    const createProjectWithCustomerSetting = await DBSendResponse(`select * from settings where company_id = ${req.body.company_id} and feature_id=72`);
    if (req.body.create_project === true || req.body.create_project === 'true' || createProjectWithCustomerSetting[0]?.feature_value === 'true') {
      //Create Project for the customer
      const insertQuery = `
      INSERT INTO project (
          pro_title, pro_description, pro_starts_on, pro_ends_on,
          pro_currency, pro_price, pro_is_active, pro_created_at, pro_updated_at,
          pro_customer_id, pro_sponsors_id, pro_contact_id, pro_manager_id, pro_com_id,
          DDD_plan_id, DDD_ID, DDD_budget_amt, last_plan_modified_date, first_billing_date,
          plan_program_name, plan_approval_date, medicaid_approv_date, active_plan_allocated, active_plan_budget,
          active_plan_version, curr_plan_allocated, curr_plan_budget, curr_plan, curr_plan_version,
          medicaid_prgm_status_code, active_plan_expended, pro_updated_by, pro_created_by, Program,
          LastMCType, LastMCDate, LastMMTUploadDate, active_plan_startdate, active_plan_duedate,
          LastAnnualVisitDate, pro_status, active_plan_creation_date, active_plan_status,
          pro_self_pay, pro_primary_payer, pro_secondary_payer
      )
      VALUES (
          'Project for ${req.body.name}', 'Created for ${req.body.name}', '${moment().format('YYYY-MM-DDTHH:mm:ss')}', '${moment().add(1, 'years').format('YYYY-MM-DDTHH:mm:ss')}',
          'USD', 0, 1, '${moment().format('YYYY-MM-DDTHH:mm:ss')}', '${moment().format('YYYY-MM-DDTHH:mm:ss')}',
          ${cus_id}, NULL, NULL, ${req.body.empId}, ${req.body.company_id},
          NULL, ${req.body.DDDID ? req.body.DDDID : 'NULL'}, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          '1', NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL,
          NULL, NULL, NULL
      ); SELECT SCOPE_IDENTITY();
    `;
      let proj_id = null;
      try {
        proj_id = await DBinsertSendID(insertQuery);
        console.log(insertQuery);

        console.log('proj_id');
        console.log(proj_id);
      } catch (err) {
        console.log(err);
      }

      //insert into projectLocation table for first location
      const insertPlocQuery = `insert into projectLocation (ploc_pro_id, ploc_loc_id) values (${proj_id}, ${locArrId?.length > 0 ? locArrId[0] : 'NULL'}); SELECT SCOPE_IDENTITY();`;
      try {
        const ploc_id = await DBinsertSendID(insertPlocQuery);
        console.log('ploc_id');
        console.log(ploc_id);
      } catch (err) {
        console.log(err);
      }
    }

    if (sendID) {
      console.log({ code: 200, id: cus_id, loc_id: locArrId, message: 'Insert Success' });
      res.json({ code: 200, id: cus_id, loc_id: locArrId, message: 'Insert Success' });
    } else {
      res.json({ code: 200, id: cus_id, message: 'Insert Success' });
    }
  }
};

async function addCustomerWithProject(req, res) {
  let name = req.body.name;
  name = name.normalize('NFC').replace('\'', '\'\'');
  const locations = req.body.address.map((add) => { return add.address_line_1 + ',' + add.address_line_2 + ',' + add.city + ',' + add.state + ',' + add.zip; }).join(':');
  const query = `insert into customer (cus_name, cus_address, cus_email, cus_phone, cus_acquired_date, cus_status, cus_type,cus_created_at,cus_company_id,cus_is_company,cus_is_active) values 
('${name}', '${locations}', '${req.body.email}', '${req.body.phone}', '${req.body.acquired_date}, '${req.body.status}', '${req.body.customer_type}', CURRENT_TIMESTAMP, ${req.body.company_id}, '${req.body.is_company}', 'true'); SELECT SCOPE_IDENTITY();`;
  const cus_id = await DBinsertSendID(query);
  if (!cus_id) { return res.json({ code: 500, message: 'Insert Failed For Customer' }); }
  const locArrId = [];
  for (var i = 0; i < req.body.address.length; i++) {
    const loc_id = await addlocation(req, res, sendId = true, address = req.body.address[i]);
    if (!loc_id) { return res.json({ code: 500, message: 'Insert Failed For Location' }); } else { locArrId.push(loc_id); }
  }
  const proj_id = await addProject(req, res, sendId = true, cusId = cus_id, locarrId = locArrId);
  if (!proj_id) { return res.json({ code: 500, message: 'Insert Failed For Projects' }); }
  const taskConfigData = await getConfigData(+req.body.company_id);
  const taskList = taskConfigData.map((c_data, indx) => {
    return { tas_name: c_data.TaskName, tas_desc: `Task Desc ${++indx}`, tas_type: c_data.TaskType, tas_mon: `DATEADD(day,${c_data.completion_days},CURRENT_TIMESTAMP)`, tas_priority: 'High', tas_note: 'Note 1' };
  });
  console.log(taskList);
  for (var i = 0; i < taskList.length; i++) {
    const taskId = await addTask(req, res, sendId = true, task = taskList[i], proj = proj_id, locId = locArrId[0]);
    if (!taskId) { return res.json({ code: 500, message: 'Insert Failed For Task' }); }
  }
  res.json({ code: 200, config: taskList, message: 'Insert Success' });
}

async function getCustomerSCHData(req, res) {
// Check if this is a lazy loading request
  if (req.query.startIndex !== undefined && req.query.endIndex !== undefined) {
    try {
    // Parse pagination, sorting, and filtering parameters
      const sortModel = req.query.sortModel ? JSON.parse(req.query.sortModel) : [];
      const filterModel = req.query.filterModel ? JSON.parse(req.query.filterModel) : { items: [] };
      const paginationModel = req.query.paginationModel ? JSON.parse(req.query.paginationModel) : { page: 0, pageSize: 50 };

      const page = paginationModel.page ?? 0;
      const pageSize = paginationModel.pageSize ?? 50;
      const offset = page * pageSize;
      const limit = pageSize; 
      
      // Use client-provided month_start as the reference to avoid UTC vs local timezone mismatch
      // (e.g. user is EST at 9pm on March 31 → server UTC is already April 1)
      const refDate = req.query.month_start
        ? moment(req.query.month_start).startOf('month')
        : moment().startOf('month');
      const currentMonthStart = refDate.format('YYYY-MM-DD');
      const nextMonthStart = refDate.clone().add(1, 'month').format('YYYY-MM-DD');
      const currentMonthFilterClause = ` AND m2.created_on >= '${currentMonthStart}' AND m2.created_on < '${nextMonthStart}'`;
    
      console.log('CustomerSCH FilterModel:', filterModel);
    
      // Helper function to build filter conditions for WHERE clauses
      const buildFilterConditions = (filterModel) => {
        if (!filterModel || !filterModel.items || filterModel.items.length === 0) {
          return '';
        }

        console.log('Building filter conditions for customer SCH data', filterModel);

        // Field mapping for filters - maps frontend column IDs to database expressions
        const getFieldExpression = (field) => {
          switch (field) {
          case 'cus_name':
          case 'customer_name':
            return 'c.cus_name';
          case 'cus_id':
            return 'c.cus_id';
          case 'DDDID':
          case 'ddd_id':
            return 'c.DDDID';
          case 'medicaid_eligible':
            return 'c.medicaid_eligible';
          case 'MedicaidEndDate':
            return 'c.MedicaidEndDate';
          case 'cus_local_id':
          case 'local_id':
            return 'c.cus_local_id';
          case 'active_plan_version':
          case 'service_plan':
            return 'p.active_plan_version';
          case 'plan_program_name':
          case 'program':
            return 'p.plan_program_name';
          case 'plan_approval_date':
            return 'p.plan_approval_date';
          case 'LastAnnualVisitDate':
          case 'last_annual_visit':
            return 'p.LastAnnualVisitDate';
          case 'LastMMTUploadDate':
          case 'last_mt_upload':
            return 'p.LastMMTUploadDate';
          case 'pro_starts_on':
          case 'plan_start_date':
            return 'p.pro_starts_on';
          case 'pro_ends_on':
          case 'plan_end_date':
            return 'p.pro_ends_on';
          case 'pro_id':
            return 'p.pro_id';
          default:
            return null;
          }
        };

        // Determine which numeric fields need numeric comparison
        const isNumericField = (field) => {
          const numericFields = [
            'cus_id', 'pro_id', 'medicaid_eligible', 'cus_local_id'
          ];
          return numericFields.includes(field);
        };

        // Build filter conditions for each filter item
        const conditions = filterModel.items
          .map(item => {
            const { field, operator, value } = item;
          
            console.log(`Processing filter: ${field} ${operator} ${value}`);
          
            // Get the database field expression
            const fieldExpr = getFieldExpression(field);
            if (!fieldExpr) {
              console.log(`Unknown field for filtering: ${field}`);
              return null;
            }

            // Handle different operators
            let condition = null;
            const isNumeric = isNumericField(field);
          
            // Escape value to prevent SQL injection
            const escapeValue = (val) => {
              if (val === null || val === undefined) return 'NULL';
              if (isNumeric && !isNaN(parseFloat(val))) {
                return parseFloat(val);
              }
              return `'${String(val).replace(/'/g, '\'\'')}'`;
            };

            switch (operator) {
            case 'equals':
              condition = `${fieldExpr} = ${escapeValue(value)}`;
              break;
            case 'not':
              condition = `${fieldExpr} != ${escapeValue(value)}`;
              break;
            case 'contains':
              condition = `${fieldExpr} LIKE '%${String(value).replace(/'/g, '\'\'')}%'`;
              break;
            case 'startsWith':
              condition = `${fieldExpr} LIKE '${String(value).replace(/'/g, '\'\'')}%'`;
              break;
            case 'endsWith':
              condition = `${fieldExpr} LIKE '%${String(value).replace(/'/g, '\'\'')}'`;
              break;
            case 'isEmpty':
              condition = `(${fieldExpr} IS NULL OR ${fieldExpr} = '')`;
              break;
            case 'isNotEmpty':
              condition = `(${fieldExpr} IS NOT NULL AND ${fieldExpr} != '')`;
              break;
            case '>':
              if (isNumeric) {
                condition = `${fieldExpr} > ${escapeValue(value)}`;
              } else {
                condition = `${fieldExpr} > ${escapeValue(value)}`;
              }
              break;
            case '>=':
              if (isNumeric) {
                condition = `${fieldExpr} >= ${escapeValue(value)}`;
              } else {
                condition = `${fieldExpr} >= ${escapeValue(value)}`;
              }
              break;
            case '<':
              if (isNumeric) {
                condition = `${fieldExpr} < ${escapeValue(value)}`;
              } else {
                condition = `${fieldExpr} < ${escapeValue(value)}`;
              }
              break;
            case '<=':
              if (isNumeric) {
                condition = `${fieldExpr} <= ${escapeValue(value)}`;
              } else {
                condition = `${fieldExpr} <= ${escapeValue(value)}`;
              }
              break;
            default:
              console.log(`Unknown operator: ${operator}`);
              return null;
            }

            if (condition) {
              console.log(`Generated condition: ${condition}`);
            }
          
            return condition;
          })
          .filter(condition => condition !== null);

        // Combine conditions with AND/OR based on logicOperator (default to AND)
        const logicOperator = filterModel.logicOperator === 'or' ? 'OR' : 'AND';
        const result = conditions.length > 0 ? `AND (${conditions.join(` ${logicOperator} `)})` : '';
      
        console.log('Final filter conditions for customer SCH:', result);
        return result;
      };
    
      // Build ORDER BY clause
      let orderByClause = 'ORDER BY cus_name ASC';
      if (sortModel && Array.isArray(sortModel) && sortModel.length > 0) {
        const sortClauses = sortModel.map(sort => {
          const column = sort.field;
          const direction = sort.sort === 'desc' ? 'DESC' : 'ASC';
        
          // Map frontend column names to database column names
          switch (column) {
          case 'customer_name': return `cus_name ${direction}`;
          case 'ddd_id': return `DDDID ${direction}`;
          case 'cus_local_id': return `cus_local_id ${direction}`;
          case 'program': return `plan_program_name ${direction}`;
          case 'plan_approval_date': return `plan_approval_date ${direction}`;
          case 'plan_start_date': return `pro_starts_on ${direction}`;
          case 'plan_end_date': return `pro_ends_on ${direction}`;
          case 'last_annual_visit': return `LastAnnualVisitDate ${direction}`;
          case 'last_mt_upload': return `LastMMTUploadDate ${direction}`;
          case 'last_download_date': return `last_download_date ${direction}`;
          case 'mmt': return `status_rank_for_sort ${direction}, mmt_sort_date ASC`;
          case 'service_plan': return `active_plan_version ${direction}`;
          default: return `cus_id ${direction}`;
          }
        });
        orderByClause = `ORDER BY ${sortClauses.join(', ')}`;
      }

      // Get total count first with filters applied
      const filterConditions = buildFilterConditions(filterModel);
      const countQuery = `SELECT COUNT(DISTINCT c.cus_id) as total_count
      FROM projectEmployeeAssignment pea
      INNER JOIN project p
          ON pea.pea_pro_id = p.pro_id
      INNER JOIN projectLocation pl
          ON pl.pLoc_pro_id = p.pro_id
      INNER JOIN location l
          ON l.loc_id = pl.pLoc_loc_id
      INNER JOIN customer c
          ON c.cus_id = p.pro_customer_id
      OUTER APPLY (
        SELECT TOP 1
          CASE
            WHEN t2.tas_mm_status = 'Waiting For Approval' THEN 1
            WHEN t2.tas_mm_status = 'Approved' THEN 2
            WHEN t2.tas_mm_status = 'Rejected' THEN 3
            ELSE 4
          END AS status_rank_for_sort,
          m2.submitted_on AS mmt_sort_date
        FROM task t2
        INNER JOIN monthlymonitoring m2 ON t2.tas_id = m2.task_id
        WHERE t2.tas_pro_id = p.pro_id${currentMonthFilterClause}
      ) r
      WHERE pea.pea_emp_id = ${req.query.emp_id} and (p.pro_is_active=1 or((p.pro_starts_on <= '1900-01-01' and p.pro_ends_on = '1900-01-02') or (p.pro_starts_on IS NULL or p.pro_ends_on IS NULL or p.pro_starts_on <= '1900-01-01'))) and c.cus_is_active=1 and pea.pea_is_active = 1
      ${filterConditions}`;
    
      console.log('Count query with filters:', countQuery);
      const countResult = await DBSendResponse(countQuery);
      console.log('Count query result:', countResult);
    
      if (!countResult || !Array.isArray(countResult) || countResult.length === 0) {
        console.error('Count query returned invalid result:', countResult);
        return res.json({
          rows: [],
          rowCount: 0
        });
      }
    
      const totalCount = countResult[0].total_count;

      const query = `WITH customer_rows AS (
        SELECT 
          c.cus_id,
          c.cus_name,
          c.DDDID,
          c.medicaid_eligible,
          c.MedicaidEndDate,
          c.cus_local_id,
          p.active_plan_version,
          p.LastAnnualVisitDate,
          p.LastMMTUploadDate,
          p.plan_program_name,
          p.plan_approval_date,
          p.pro_starts_on,
          p.pro_ends_on,
          p.pro_id,
          l.loc_id,
          l.loc_lat,
          l.loc_lon,
          CAST(NULL AS DATETIME) AS last_download_date,
          COALESCE(r.status_rank_for_sort, 5) AS status_rank_for_sort,
          r.mmt_sort_date,
          ROW_NUMBER() OVER (
            PARTITION BY c.cus_id
            ORDER BY 
              CASE WHEN p.pro_is_active = 1 THEN 0 ELSE 1 END,
              p.pro_ends_on DESC,
              p.pro_id DESC,
              l.loc_id DESC
          ) AS row_num
        FROM projectEmployeeAssignment pea
        INNER JOIN project p
            ON pea.pea_pro_id = p.pro_id
        INNER JOIN projectLocation pl
            ON pl.pLoc_pro_id = p.pro_id
        INNER JOIN location l
            ON l.loc_id = pl.pLoc_loc_id
        INNER JOIN customer c
            ON c.cus_id = p.pro_customer_id
        OUTER APPLY (
          SELECT TOP 1
            CASE
              WHEN t2.tas_mm_status = 'Waiting For Approval' THEN 1
              WHEN t2.tas_mm_status = 'Approved' THEN 2
              WHEN t2.tas_mm_status = 'Rejected' THEN 3
              ELSE 4
            END AS status_rank_for_sort,
            m2.submitted_on AS mmt_sort_date
          FROM task t2
          INNER JOIN monthlymonitoring m2 ON t2.tas_id = m2.task_id
          WHERE t2.tas_pro_id = p.pro_id${currentMonthFilterClause}
        ) r
        WHERE pea.pea_emp_id = ${req.query.emp_id} and (p.pro_is_active=1 or((p.pro_starts_on <= '1900-01-01' and p.pro_ends_on = '1900-01-02') or (p.pro_starts_on IS NULL or p.pro_ends_on IS NULL or p.pro_starts_on <= '1900-01-01'))) and c.cus_is_active=1 and pea.pea_is_active = 1
        ${filterConditions}
      )
      SELECT 
        cus_id,
        cus_name,
        DDDID,
        medicaid_eligible,
        MedicaidEndDate,
        cus_local_id,
        active_plan_version,
        LastAnnualVisitDate,
        LastMMTUploadDate,
        plan_program_name,
        plan_approval_date,
        pro_starts_on,
        pro_ends_on,
        pro_id,
        loc_id,
        loc_lat,
        loc_lon,
        last_download_date,
        status_rank_for_sort,
        mmt_sort_date
      FROM customer_rows
      WHERE row_num = 1
      ${orderByClause}
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

      console.log('Executing lazy loading query with filters:', query);
      let customers = await DBSendResponse(query);
    
      // Add safety check for customers result
      if (!customers || !Array.isArray(customers)) {
        console.error('DBSendResponse returned invalid data:', customers);
        customers = [];
      }

      // Deduplicate customers by cus_id (same as original implementation)
      const seen = new Set();
      customers = customers.filter(obj => !seen.has(obj.cus_id) && seen.add(obj.cus_id));

      // Get additional data needed for month calculations
      // Use broader date range to capture previous months' data
      const startDate = refDate.clone().subtract(11, 'months').format('YYYY-MM-DD');
      // Use the start of next month (exclusive upper bound) so that tasks whose
      // checkoutEmpDate falls on the last day of the month with a non-zero time
      // component are not excluded by SQL Server's implicit midnight cast of a
      // date-only string (e.g. '2026-04-30' → '2026-04-30 00:00:00').
      const endDate = refDate.clone().add(1, 'month').startOf('month').format('YYYY-MM-DD');
    
      const query2 = `WITH scoped_projects AS (
        SELECT DISTINCT pea.pea_pro_id
        FROM projectEmployeeAssignment pea
        WHERE pea.pea_emp_id = ${req.query.emp_id}
          AND pea.pea_is_active = 1
      )
      SELECT 
        t.*,
        e.checkoutEmpDate,
        e.empLocdate,
        p.pro_customer_id,
        COALESCE(mmAgg.monthlyMonitoring, '[]') AS monthlyMonitoring,
        COALESCE(locAgg.locInfo, '[]') AS locInfo
      FROM scoped_projects sp
      INNER JOIN project p ON p.pro_id = sp.pea_pro_id
      INNER JOIN task t ON t.tas_pro_id = p.pro_id
      INNER JOIN empLocate e ON e.taskId = t.tas_id
      INNER JOIN employee emp ON emp.emp_id = e.empId AND emp.emp_company_id = ${req.query.comp_id}
      INNER JOIN customer c ON c.cus_id = p.pro_customer_id AND c.cus_is_active = 1
      OUTER APPLY (
        SELECT *
        FROM monthlymonitoring mm
        WHERE mm.task_id = t.tas_id
        FOR JSON PATH, INCLUDE_NULL_VALUES
      ) mmAgg(monthlyMonitoring)
      OUTER APPLY (
        SELECT *
        FROM location
        WHERE loc_id IN (t.tas_loc_id, t.tas_loc1_id, t.tas_loc2_id)
        FOR JSON PATH
      ) locAgg(locInfo)
      WHERE e.checkoutEmpDate >= '${startDate}' AND e.checkoutEmpDate < '${endDate}'
        AND t.tas_is_active <> 2
        AND t.tas_type != 'Checklist';`;

      console.log(query2);
      
    
      const query3 = `select a.*, p.pro_title, t.tas_title, t.tas_id, e.emp_id, e.emp_first_name, e.emp_last_name from artifacts a LEFT JOIN project p on a.project_id=p.pro_id LEFT JOIN task t on a.task_id=t.tas_id INNER JOIN employee e on a.employee_id=e.emp_id where a.employee_id=${req.query.emp_id}`;
    
      const query4 = `select m.monthly_monitoring_id, m.data, created_on, p.pro_customer_id from monthlymonitoring m INNER JOIN task t on t.tas_id=m.task_id INNER JOIN project p on t.tas_pro_id=p.pro_id 
      WHERE m.employee_id=${req.query.emp_id} and t.tas_mm_id IS NOT NULL 
          AND (m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 1, 0)) - 11, 0) 
          OR m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 2, 0)) - 11, 0) 
          OR m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 3, 0)) - 11, 0))`;

      let allTasks = await DBSendResponse(query2);      
      let allArtifacts = await DBSendResponse(query3);
      let allMonthlyMonitoring = await DBSendResponse(query4);

      // Add safety checks for additional queries
      const safeParseJsonArray = (value, label = 'payload') => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
          console.warn(`Failed to parse ${label} JSON array`, err);
          return [];
        }
      };

      if (!allTasks || !Array.isArray(allTasks)) {
        allTasks = [];
      } else {
        allTasks = allTasks.map(task => ({
          ...task,
          monthlyMonitoring: safeParseJsonArray(task.monthlyMonitoring, 'monthlyMonitoring'),
          locInfo: safeParseJsonArray(task.locInfo, 'locInfo')
        }));
      }
      if (!allArtifacts || !Array.isArray(allArtifacts)) allArtifacts = [];
      if (!allMonthlyMonitoring || !Array.isArray(allMonthlyMonitoring)) allMonthlyMonitoring = [];

      // Process paginated customers with month data
      const processedCustomers = await Promise.all(customers.map(async (customer) => {
        const filterTasksByMonth = (tasks, month) => {
          return tasks.filter((task) => {
            // Use client-derived refDate so month buckets align with the user's local timezone
            return moment(task.checkoutEmpDate).isSame(refDate.clone().subtract(month, 'months'), 'month');
          });
        };

        const filterMTSByMonth = (mts, month) => {
          return mts.filter((mt) => {
            return moment(mt.created_on).isAfter(refDate.clone().subtract(12 - month, 'months'));
          });
        };

        const filterMTSByType = (mts, type) => {
          return mts.filter((mt) => {
            if (!mt.data) return false;
            try {
              const data = JSON.parse(mt.data);
              if (data?.section_1?.m?.answer === type) return true;
            } catch (e) {
              console.error('Error parsing MT data:', e);
            }
            return false;
          });
        };

        let tasks = allTasks.filter((task) => { return task.pro_customer_id === customer.cus_id; });
        tasks = tasks.map((t) => {
          const task = { ...t };
          task.locInfo = Array.isArray(task.locInfo) ? task.locInfo : [];
          task.monthlyMonitoring = Array.isArray(task.monthlyMonitoring) ? task.monthlyMonitoring : [];
          return task;
        });

        const month1 = filterTasksByMonth(tasks, 11);
        const month2 = filterTasksByMonth(tasks, 10);
        const month3 = filterTasksByMonth(tasks, 9);
        const month4 = filterTasksByMonth(tasks, 8);
        const month5 = filterTasksByMonth(tasks, 7);
        const month6 = filterTasksByMonth(tasks, 6);
        const month7 = filterTasksByMonth(tasks, 5);
        const month8 = filterTasksByMonth(tasks, 4);
        const month9 = filterTasksByMonth(tasks, 3);
        const month10 = filterTasksByMonth(tasks, 2);
        const month11 = filterTasksByMonth(tasks, 1);
        const month12 = filterTasksByMonth(tasks, 0);

        let mts = allMonthlyMonitoring.filter((mt) => { return mt.pro_customer_id === customer.cus_id; });
        mts = filterMTSByType(mts, 'home_visit');

        let futureMonth1, futureMonth2, futureMonth3 = [];

        if (customer.LastAnnualVisitDate !== null) {
          let monthsSinceLastHomeVisit = moment().diff(moment(customer.LastAnnualVisitDate), 'months');
          if (monthsSinceLastHomeVisit < 11)
            futureMonth1 = ['Doesn\'t need a home visit'];
          if (monthsSinceLastHomeVisit < 10)
            futureMonth2 = ['Doesn\'t need a home visit'];
          if (monthsSinceLastHomeVisit < 9)
            futureMonth3 = ['Doesn\'t need a home visit'];
          else {
            futureMonth1 = filterMTSByMonth(mts, 1);
            futureMonth2 = filterMTSByMonth(mts, 2);
            futureMonth3 = filterMTSByMonth(mts, 3);
          }
        } else {
          futureMonth1 = filterMTSByMonth(mts, 1);
          futureMonth2 = filterMTSByMonth(mts, 2);
          futureMonth3 = filterMTSByMonth(mts, 3);
        }
      
        const artifacts = allArtifacts.filter((artifact) => { return artifact.customer_id === customer.cus_id; });

        let hadHomeVisit = false;
        let hadVisit = false;
        const query = `SELECT m.monthly_monitoring_id, m.data, m.mt_period
      FROM monthlymonitoring m
      INNER JOIN task t ON t.tas_id = m.task_id
      INNER JOIN project p ON t.tas_pro_id = p.pro_id
      WHERE p.pro_customer_id = ${customer.cus_id}
      AND t.tas_mm_id IS NOT NULL
      AND m.created_on >= DATEADD(MONTH, DATEDIFF(MONTH, 0, DATEADD(month, DATEDIFF(month, 0, GETDATE()) + 1, 0)) - 2, 0)`;

        let allVisits = await DBSendResponse(query);
        if (!allVisits || !Array.isArray(allVisits)) allVisits = [];
      
        const futureMonths = [futureMonth1, futureMonth2, futureMonth3].map((month, index) => {
          if (month.length > 0 || hadHomeVisit) {
            const visitsThisMonth = allVisits.filter(visit => {
              const visitDate = moment(visit.mt_period);
              if (visitDate.isSameOrAfter(refDate.clone().subtract(1 - index, 'months').startOf('month')))
                return visitDate.isSameOrAfter(refDate.clone().subtract(1 - index, 'months').startOf('month'));
            });

            let homeVisit = filterMTSByType(visitsThisMonth, 'home_visit');
            let faceToFaceVisit = filterMTSByType(visitsThisMonth, 'face_to_face');

            if (faceToFaceVisit.length > 0 || homeVisit.length > 0 || hadVisit || hadHomeVisit) {
              return 'Phone Call';
            } else {
              hadVisit = true;
              return 'Visit';
            }
          } else {
            hadHomeVisit = true;
            return 'Home Visit';
          }
        });

        return {
          ...customer,
          artifacts,
          month1: month1,
          month2: month2,
          month3: month3,
          month4: month4,
          month5: month5,
          month6: month6,
          month7: month7,
          month8: month8,
          month9: month9,
          month10: month10,
          month11: month11,
          month12: month12,
          futureMonth1: futureMonths[0],
          futureMonth2: futureMonths[1],
          futureMonth3: futureMonths[2],
        };
      }));

      return res.json({
        rows: processedCustomers,
        rowCount: totalCount
      });
    } catch (error) {
      console.error('Error in lazy loading getCustomerSCHData:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

exports.getCustomerImage = async (req, res) => {
  let { customer_id } = req.query;

  try {
    const query = `SELECT * FROM customer_images WHERE customer_id = ${customer_id}`;
    const response = await DBSendResponse(query);

    if (response && response.length > 0) {
      res.status(200).json({ image: response[0].image });
    } else {
      res.status(204).json({ error: 'No image found for this customer' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while retrieving the customer image' });
  }
};

exports.addCustomerImage = async (req, res) => {
  if (!req.file || Object.keys(req.file).length === 0 || req.body.customer_id === undefined) {
    return res.status(400).send('No files were uploaded.');
  }

  let { customer_id } = req.body;

  let customerImage = req.file;

  if (customerImage.size > 1 * 1024 * 1024) {
    return res.status(400).send('File size should not exceed 1MB.');
  }

  let base64Image = customerImage.buffer.toString('base64');

  const existingImageQuery = `SELECT * FROM customer_images WHERE customer_id = ${customer_id}`;
  const existingImage = await DBSendResponse(existingImageQuery);

  try {
    let query = null;
    if (existingImage != 0) {
      query = `UPDATE customer_images SET image = '${base64Image}' WHERE customer_id = ${customer_id}`;
      await DBSendResponse(query);
    } else {
      query = `INSERT INTO customer_images (customer_id, image) VALUES (${customer_id}, '${base64Image}'); SELECT SCOPE_IDENTITY();`;
      await DBinsertSendID(query);
    }

    res.status(200).json({ message: 'Customer image added successfully' });
  } catch (err) {
    console.error('Failed to add customer image:', err);
    res.status(500).json({ error: 'An error occurred while adding the customer image' });
  }
};

exports.updateCustomerEmail = async (req, res) => {
  try {
    const data = {
      cus_email: generateSQLText(req.body.cus_email, 255, null),
    };
    const query = generateUpdateSQL('customer', data, `cus_id = ${parseInt(req.body.cus_id)}`);
    await DBSendResponse(query);

    res.status(200).json({
      message: 'Customer Email updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateCustomerEmail Query Failed:');
    console.log(err);
    res.status(400).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.addEmployeeCustomerPreference = async (req, res) => {
  try {
    const { employee_id, customer_id, preference_level } = req.body;

    // Validate required fields
    if (!employee_id || !customer_id) {
      return res.status(400).json({
        message: 'employee_id and customer_id are required'
      });
    }

    // Validate employee_id and customer_id are numbers
    if (isNaN(parseInt(employee_id)) || isNaN(parseInt(customer_id))) {
      return res.status(400).json({
        message: 'employee_id and customer_id must be valid numbers'
      });
    }

    // Validate preference_level if provided
    if (preference_level !== undefined && preference_level !== null && isNaN(parseInt(preference_level))) {
      return res.status(400).json({
        message: 'Preference level must be a valid number'
      });
    }

    // Build insert query
    const query = `INSERT INTO customer_employee_preference (
      customer_id, 
      employee_id, 
      preference_level,
      created_at
    ) VALUES (
      ${parseInt(customer_id)}, 
      ${parseInt(employee_id)}, 
      ${preference_level !== undefined && preference_level !== null ? parseInt(preference_level) : 'NULL'},
      SYSUTCDATETIME()
    ); SELECT SCOPE_IDENTITY();`;

    const preference_id = await DBinsertSendID(query);

    if (!preference_id) {
      return res.status(500).json({
        message: 'Failed to add employee customer preference'
      });
    }

    res.status(200).json({
      message: 'Employee customer preference added successfully',
      preference_id: preference_id
    });
  } catch (err) {
    console.log('ERROR | addEmployeeCustomerPreference failed:');
    console.log(err);
    
    // Handle unique constraint violation
    if (err.message && err.message.includes('uq_customer_employee')) {
      return res.status(409).json({
        message: 'A preference already exists for this employee-customer pair'
      });
    }
    
    res.status(500).json({
      message: 'An error occurred while adding employee customer preference'
    });
  }
};

exports.updateEmployeeCustomerPreference = async (req, res) => {
  try {
    const { preference_id, employee_id, customer_id, preference_level } = req.body;

    // Validate: must have either preference_id OR (employee_id + customer_id)
    if (!preference_id && (!employee_id || !customer_id)) {
      return res.status(400).json({
        message: 'Preference ID or (Employee ID and Customer ID) are required'
      });
    }

    // Validate IDs are numbers if provided
    if (preference_id && isNaN(parseInt(preference_id))) {
      return res.status(400).json({
        message: 'Preference ID must be a valid number'
      });
    }

    if (employee_id && isNaN(parseInt(employee_id))) {
      return res.status(400).json({
        message: 'Employee ID must be a valid number'
      });
    }

    if (customer_id && isNaN(parseInt(customer_id))) {
      return res.status(400).json({
        message: 'Customer ID must be a valid number'
      });
    }

    // Validate preference_level if provided
    if (preference_level !== undefined && preference_level !== null && isNaN(parseInt(preference_level))) {
      return res.status(400).json({
        message: 'Preference level must be a valid number'
      });
    }

    // Build SET clause for fields to update
    const updates = [];
    if (preference_level !== undefined && preference_level !== null) {
      updates.push(`preference_level = ${parseInt(preference_level)}`);
    } else if (preference_level === null) {
      updates.push('preference_level = NULL');
    }

    updates.push('updated_at = SYSUTCDATETIME()');

    if (updates.length === 1) {
      // Only updated_at, no actual data to update
      return res.status(400).json({
        message: 'No fields provided to update'
      });
    }

    // Build WHERE clause
    const whereClause = preference_id 
      ? `preference_id = ${parseInt(preference_id)}`
      : `customer_id = ${parseInt(customer_id)} AND employee_id = ${parseInt(employee_id)}`;

    const query = `UPDATE customer_employee_preference 
      SET ${updates.join(', ')} 
      WHERE ${whereClause}`;

    const result = await DBUpdate(query);

    if (result === 0) {
      return res.status(404).json({
        message: 'Employee customer preference not found'
      });
    }

    res.status(200).json({
      message: 'Employee customer preference updated successfully'
    });
  } catch (err) {
    console.log('ERROR | updateEmployeeCustomerPreference failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while updating employee customer preference'
    });
  }
};

exports.getEmployeeCustomerPreference = async (req, res) => {
  try {
    const { employee_id, customer_id, preference_id } = req.query;

    // Validate: at least one parameter is required
    if (!employee_id && !customer_id && !preference_id) {
      return res.status(400).json({
        message: 'At least one query parameter is required: employee_id, customer_id, or preference_id'
      });
    }

    // Build WHERE clause dynamically based on provided parameters
    const conditions = [];

    if (preference_id) {
      if (isNaN(parseInt(preference_id))) {
        return res.status(400).json({
          message: 'preference_id must be a valid number'
        });
      }
      conditions.push(`preference_id = ${parseInt(preference_id)}`);
    }

    if (employee_id) {
      if (isNaN(parseInt(employee_id))) {
        return res.status(400).json({
          message: 'employee_id must be a valid number'
        });
      }
      conditions.push(`employee_id = ${parseInt(employee_id)}`);
    }

    if (customer_id) {
      if (isNaN(parseInt(customer_id))) {
        return res.status(400).json({
          message: 'customer_id must be a valid number'
        });
      }
      conditions.push(`customer_id = ${parseInt(customer_id)}`);
    }

    const whereClause = conditions.join(' AND ');

    // Query with employee and customer details
    const query = `
      SELECT 
        cep.preference_id,
        cep.customer_id,
        cep.employee_id,
        cep.preference_level,
        cep.created_at,
        cep.updated_at,
        c.cus_name,
        CONCAT(e.emp_first_name, ' ', e.emp_last_name) as employee_name
      FROM customer_employee_preference cep
      INNER JOIN customer c ON cep.customer_id = c.cus_id
      INNER JOIN employee e ON cep.employee_id = e.emp_id
      WHERE ${whereClause}
      ORDER BY cep.created_at DESC`;

    const preferences = await DBSendResponse(query);

    res.status(200).json({
      message: 'Employee customer preferences retrieved successfully',
      preferences: preferences || [],
      count: preferences?.length || 0
    });
  } catch (err) {
    console.log('ERROR | getEmployeeCustomerPreference failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while retrieving employee customer preferences'
    });
  }
};

exports.deleteEmployeeCustomerPreference = async (req, res) => {
  try {
    const { preference_id, employee_id, customer_id } = req.body;

    // Validate: must have either preference_id OR (employee_id + customer_id)
    if (!preference_id && (!employee_id || !customer_id)) {
      return res.status(400).json({
        message: 'Preference ID or (Employee ID and Customer ID) are required'
      });
    }

    // Validate IDs are numbers if provided
    if (preference_id && isNaN(parseInt(preference_id))) {
      return res.status(400).json({
        message: 'Preference ID must be a valid number'
      });
    }

    if (employee_id && isNaN(parseInt(employee_id))) {
      return res.status(400).json({
        message: 'Employee ID must be a valid number'
      });
    }

    if (customer_id && isNaN(parseInt(customer_id))) {
      return res.status(400).json({
        message: 'Customer ID must be a valid number'
      });
    }

    // Build WHERE clause
    const whereClause = preference_id 
      ? `preference_id = ${parseInt(preference_id)}`
      : `customer_id = ${parseInt(customer_id)} AND employee_id = ${parseInt(employee_id)}`;

    // Hard delete query (as table doesn't have is_active column)
    const query = `DELETE FROM customer_employee_preference WHERE ${whereClause}`;

    const result = await DBUpdate(query);

    if (result === 0) {
      return res.status(404).json({
        message: 'Employee customer preference not found'
      });
    }

    res.status(200).json({
      message: 'Employee customer preference deleted successfully'
    });
  } catch (err) {
    console.log('ERROR | deleteEmployeeCustomerPreference failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while deleting employee customer preference'
    });
  }
};

/**
 * Get customer assignment history as CSV
 * Returns a CSV file containing the history of employee assignments for a customer
 */
exports.getCustomerAssignmentHistory = async function (req, res) {
  try {
    const { customer_id, company_id } = req.query;

    // Validate required parameters
    if (!customer_id) {
      return res.status(400).json({
        message: 'Customer ID is required'
      });
    }

    if (!company_id) {
      return res.status(400).json({
        message: 'Company ID is required'
      });
    }

    // Validate IDs are numbers
    if (isNaN(parseInt(customer_id))) {
      return res.status(400).json({
        message: 'Customer ID must be a valid number'
      });
    }

    if (isNaN(parseInt(company_id))) {
      return res.status(400).json({
        message: 'Company ID must be a valid number'
      });
    }

    const query = `
      SELECT 
        pea.pea_status as 'association status',
        CONCAT(e.emp_first_name, ' ', e.emp_last_name, ' (', e.emp_id, ')') as 'employee',
        pea.pea_associate_from as 'association start',
        pea.pea_associate_to as 'association end',
        pea.pea_created_at as 'created on',
        ISNULL(pea.pea_updated_at, pea.pea_created_at) as 'last updated'
      FROM projectEmployeeAssignment pea
      INNER JOIN project p ON pea.pea_pro_id = p.pro_id
      INNER JOIN employee e ON pea.pea_emp_id = e.emp_id
      WHERE p.pro_customer_id = ${parseInt(customer_id)}
      ORDER BY pea.pea_id DESC
    `;

    const results = await DBSendResponse(query);

    // Convert results to CSV format
    if (!results || results.length === 0) {
      return res.status(404).json({
        message: 'No assignment history found for this customer'
      });
    }

    // Build CSV header from the first result object keys
    const headers = Object.keys(results[0]);
    const csvHeader = headers.join(',');

    // Build CSV rows
    const csvRows = results.map(row => {
      return headers.map(header => {
        const value = row[header];
        // Escape values that contain commas or quotes
        if (value === null || value === undefined) {
          return '';
        }
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    });

    // Combine header and rows
    const csv = [csvHeader, ...csvRows].join('\n');

    // Set response headers for CSV download
    const timestamp = moment().format('YYYY-MM-DD-HHmmss');
    const filename = `customer-${customer_id}-employee-history-${timestamp}.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);

  } catch (err) {
    console.log('ERROR | getCustomerAssignmentHistory failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while generating employee assignment history'
    });
  }
};

exports.getCustomersAtSameAddress = async function (req, res) {
  try {
    const {
      address,
      city,
      state,
      zip,
      exclude_cus_id,
      comp_id
    } = req.query;

    const companyId = Number.parseInt(comp_id, 10);
    const excludedCustomerId = Number.parseInt(exclude_cus_id, 10);

    if (!Number.isInteger(companyId)) {
      return res.status(400).json({
        message: 'A valid company ID is required'
      });
    }

    if (!address || !city || !state || !zip) {
      return res.status(400).json({
        message: 'Address, city, state, and ZIP are required'
      });
    }

    // cus_address format: street,address line 2,city,state,zip
    // Address line 2 is currently empty in the frontend request.
    const requestedAddress = [
      address,
      '',
      city,
      state,
      zip
    ].map(value => String(value).trim()).join(',');

    // Normalize casing and whitespace because stored values may contain
    // inconsistent spaces, e.g. "306 FINLEY CT, ,Somerset ,NJ,8873".
    const escapedAddress = requestedAddress
      .replace(/'/g, '\'\'')
      .toUpperCase()
      .replace(/\s/g, '');

    const whereConditions = [
      `cus_company_id = ${companyId}`,
      'cus_is_active = 1',
      `REPLACE(UPPER(cus_address), ' ', '') = '${escapedAddress}'`
    ];

    if (Number.isInteger(excludedCustomerId)) {
      whereConditions.push(`cus_id <> ${excludedCustomerId}`);
    }

    const query = `
      SELECT
        cus_id,
        cus_first_name,
        cus_last_name,
        cus_name,
        cus_phone,
        cus_address
      FROM dbo.customer
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY cus_first_name, cus_last_name, cus_name
    `;

    console.log(query);

    const results = await DBSendResponse(query);
    return res.status(200).json(results || []);
  } catch (err) {
    console.log('ERROR | getCustomersAtSameAddress failed:');
    console.log(err);

    return res.status(500).json({
      message: 'An error occurred while fetching customers at the same address',
      error: err.message
    });
  }
};
