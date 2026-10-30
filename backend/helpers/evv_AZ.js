const { DBSendResponse, DBUpdate, DBInsertAndReturn } = require("../queries/commonQueries");
const moment = require("moment");
const API = require("./evv_AZ_send");
const { Promise } = require("mssql");
var cron = require('node-cron');
var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require("@segment/analytics-node");
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

let processID = '';
let SequenceCount = parseInt(moment().format("YYYYMMDDHHMMSS"));
let callID = parseInt(moment().format("YYYYMMDDHHMMSS"));

const sendEVV_AZ_Scheduler = async () => {
  cron.schedule('*/60 * * * *', async function () {
    var getCompanyIdsQuery = `SELECT company.com_id, credentials.cred_clientID as 'UserID', credentials.cred_clientSecret as 'PASSWORD', credentials.bus_entity_id as 'BusinessEntityID', credentials.bus_entity_Medicaid_identifier as 'BusinessEntityMedicaidIdentifier'
    FROM company 
    JOIN settings ON company.com_id = settings.company_id 
    JOIN credentials ON company.com_id = credentials.cred_company_id
    WHERE ((settings.feature_id = 99 AND settings.state_id = 'AZ') OR settings.feature_id = 11) AND settings.feature_id IN (11, 99) 
    GROUP BY company.com_id, credentials.cred_clientID, credentials.cred_clientSecret, credentials.bus_entity_id, credentials.bus_entity_Medicaid_identifier
    HAVING COUNT(DISTINCT settings.feature_id) = 2`
    var companyIds = await DBSendResponse(getCompanyIdsQuery);

    console.log("Scheduler triggered at: " + new Date())
    var invocationTimestamp = moment().format('YYYY-MM-DDTHH:mm:ss')
    console.log("\n| INFO | invocationTimestamp of sendEVV_AZ_Scheduler run is", invocationTimestamp)

    for (const cid of companyIds) {
      console.log("\n| INFO | Running for the company ID", cid.com_id)
      let payloadData = await getPayloadData(cid.com_id);
      let customers = await sendCustomer(cid.com_id, cid.UserID, cid.PASSWORD, cid.BusinessEntityID, cid.BusinessEntityMedicaidIdentifier, payloadData);
      let employees = await sendEmployee(cid.com_id, cid.UserID, cid.PASSWORD, cid.BusinessEntityID, cid.BusinessEntityMedicaidIdentifier, payloadData);
      let visits = await sendVisit(cid.com_id, cid.UserID, cid.PASSWORD, cid.BusinessEntityID, cid.BusinessEntityMedicaidIdentifier, payloadData);
      console.log(customers, employees, visits, cid.com_id);
      analytics.track({
        userId: String(cid.com_id),
        event: 'EVV run completed',
        context: {
          groupId: String(cid.com_id),
        },
        properties: {
            companyId: cid.com_id,
            noOfEmployeesSent: employees.recordsSent,
            noOfEmployeesSuccessfullySent: employees.recordsSuccessfullySent,
            noOfEmployeesFailed: employees.recordsFailed,
            noOfVisitsSent: visits.recordsSent,
            noOfVisitsSuccessfullySent: visits.recordsSuccessfullySent,
            noOfVisitsFailed: visits.recordsFailed,
            noOfCustomersSent: customers.recordsSent,
            noOfCustomersSuccessfullySent: customers.recordsSuccessfullySent,
            noOfCustomersFailed: customers.recordsFailed,
        }
      })
      await sleep(1000)
    }
  });
}

const getPayloadData = async (com_id) => {
  var minCheckoutTime = moment().add(-12, 'h').format('YYYY-MM-DDTHH:mm:ss');

  const query = `SELECT DISTINCT task.tas_id, task.tas_type, task.tas_start_time, task.tas_end_time,
  task.tas_start_date, task.tas_end_date,
  task.tas_billable_by_default, task.tas_created_at,
  empLocate.empLocdate, empLocate.checkoutEmpDate,
  customer.cus_id as cus_id,
  customer.cus_address as cus_address,
  customer.cus_name as cus_name,
  customer.medicaid_id as cust_medicaid_id,
  customer.cus_local_id as cus_local_id, 
  employee.ssn as emp_ssn,
  employee.emp_last_name as emp_last_name,
  employee.emp_first_name as emp_first_name,
  employee.empEmail as empEmail,
  payer.payer_name as payer_name,
  procedure_code.procProcCode as proc_code,
  procedure_code.procModifierCode as modifier_code,
  location.loc_lat as lat,
  location.loc_lon as lon,
  (SELECT * FROM artifacts WHERE artifacts.task_id = task.tas_id for JSON PATH) as artifacts_present
FROM task
  JOIN project on task.tas_pro_id = project.pro_id
  JOIN customer on project.pro_customer_id = customer.cus_id
  JOIN employee on task.tas_emp_id = employee.emp_id
  JOIN empLocate on task.tas_id = empLocate.taskId
  JOIN company on company.com_id = task.tas_com_id 
  JOIN payer on  company.payerId = payer.payer_id
  JOIN dropdowns on dropdowns.EntityValue = task.tas_type and dropdowns.CompanyID = task.tas_com_id
  JOIN TaskProcCodeMapping on TaskProcCodeMapping.dropdown_id = dropdowns.ddID
  JOIN procedure_code on procedure_code.procCode_id = TaskProcCodeMapping.procedure_code_id
  JOIN location on location.loc_company_id = company.com_id and location.loc_id = task.tas_loc_id
WHERE tas_com_id = ${com_id} and (tas_type LIKE '%Visit') and checkoutEmpDate > '${minCheckoutTime}' and tas_is_active = 1 and tas_billable_by_default = 1 and procedure_code.state_id = 'AZ'`;

  let tasks = await DBSendResponse(query);

  return tasks
}

//sending employee info
const sendEmployee = async (com_id, UserID, PASSWORD, BusinessEntityID, BusinessEntityMedicaidIdentifier, payloadData) => {
  console.log("EVV AZ (Employee) Scheduler triggered at: " + new Date())
  let summary = {recordsSent: 0, recordsSuccessfullySent: 0, recordsFailed: 0}
  let invocationTimestamp = moment().format('YYYY-MM-DDTHH:mm:ss')
  console.log("\n| INFO | invocationTimestamp of sendEVV_AZ_EmployeeDataByScheduler run is", invocationTimestamp)

  let employees = [];
  let ids = new Set(); // Using a Set to track unique ids

  for (let obj of payloadData) {
    if (!ids.has(obj.emp_ssn)) {
      employees.push(obj);
      ids.add(obj.emp_ssn);
    }
  }

  const auth = {
    username: UserID,
    password: PASSWORD,
  };

  const headers = {
    account: BusinessEntityID,
  };

  const queryTryAgainLogs = `select * from evv_AZ_log where payloadType = 'EMPLOYEE' and status = 'TRY AGAIN' and evvLogComid = ${com_id}`
  let evvTryAgainLogs = await DBSendResponse(queryTryAgainLogs);

  evvTryAgainLogs = evvTryAgainLogs.reduce((accumulator, current) => {
    if (!accumulator.some(item => item.transactionID === current.transactionID)) {
      accumulator.push(current);
    }
    return accumulator;
  }, []);

  try {
    await Promise.all(evvTryAgainLogs.map(async (log) => {
      console.log(`\n| INFO | Status Check from SanData for employees with status 'TRY AGAIN'`);
      let statusResp = await API.checkStatusEmployee(log.transactionID, auth, headers);

      console.log(`\n| DEBUG | Employee Status Response from Sandata`);
      console.log(statusResp);

      if (statusResp.messageSummary == "The result for the input UUID is not ready yet. Please try again.") {
        return summary;
      }

      await updateAZProcessLogTable(log.transactionID, statusResp.succeededCount, statusResp.failedCount, statusResp.status, JSON.stringify(statusResp.data), log.processlogID, log.processID)

      await updateAZLogTableSuccess("SUCCESS", '', log.transactionID)

      if (statusResp.status === 'FAILED') {
        console.log(`\n| INFO | Status Check = FAILED`)

        statusResp.data.forEach(async (data) => {
          const currSeqID = data.SequenceID;
          const error = data.ErrorMessage;

          await updateAZLogTableFailed("FAILED", error, currSeqID);
        });
      }
      else if (statusResp.status === 'SUCCESS') {
        console.log(`\n| INFO | Status Check = SUCCESS`)
      }
      else {
        console.log(`\n-*-*-*-*-*-*-*-*-*-*-*-*-`)
      }
    }));
  }
  catch (err) {
    console.log(`| ERROR Failed to do Status Check from SanData for employees with status 'TRY AGAIN' | ${err}`)
  }

  const queryToGetEVVLog = `select * from evv_AZ_log where payloadType = 'EMPLOYEE' and status != 'FAILED' and evvLogComid = ${com_id}`;
  let evvLogs = await DBSendResponse(queryToGetEVVLog);

  evvLogs = evvLogs.map((x) => x.empID);

  employees = employees.filter((employee) => !evvLogs.includes(employee.emp_ssn.toString()));

  let payload = []

  await Promise.all(employees.map(async (employee) => {
    const record = {
      ProviderIdentification: {
        ProviderQualifier: "MedicaidID",
        ProviderID: BusinessEntityMedicaidIdentifier,
      },
      EmployeeQualifier: "EmployeeSSN",
      EmployeeIdentifier: employee.emp_ssn,
      SequenceID: SequenceCount,
      EmployeeSSN: employee.emp_ssn,
      EmployeeLastName: employee.emp_last_name,
      EmployeeFirstName: employee.emp_first_name,
      EmployeeEmail: employee.empEmail,
    };

    SequenceCount = SequenceCount + 1;
    summary.recordsSent += 1;
    payload.push(record);
  }))

  // Populate Initial Process Log Entry
  let evvProcessLogResponse = await populateAZProcessLogTable(com_id, invocationTimestamp, payload.length, 0, 0, "EMPLOYEE")
  let evvProcessLogId = evvProcessLogResponse.id

  console.log("----------Employee Payload----------")
  console.log(payload)

  try {
    if (payload.length === 0) {
      console.log(`| No Employee Records to send`)
      updateAZProcessLogTable(204, 0, 0, "NO RECORDS TO SEND", "", evvProcessLogId, processID)
      return summary;
    }
    else {
      var response = await API.uploadEmployeeData(payload, auth, headers);
    }
  }
  catch (err) {
    console.log(`| ERROR (Employee Payload Submission) | ${err}`)
    await updateAZProcessLogTable(404, 0, 0, "FAILED", "ERROR: Failed to establish connection with SanData", evvProcessLogId, processID)

    // Logging each payload record in EVV AZ Table
    let evvIDs = {}
    for (let i = 0; i < payload.length; i++) {
      let evvAZResponse = await processEvvAZTableForEmp(com_id, 404, payload[i], payload[i].EmployeeIdentifier, evvProcessLogId)
      evvIDs[payload[i].SequenceID] = evvAZResponse.id
    }
    for (let i = 0; i < payload.length; i++) {
      let currId = payload[i].EmployeeIdentifier
      let currSeqID = payload[i].SequenceID
      populateAZLogTableForEmp(com_id, invocationTimestamp, 404, "EMPLOYEE", currId, evvProcessLogId, "FAILED", currSeqID, "ERROR: Failed to establish connection with SanData", evvIDs[currSeqID], processID)
    }
    return summary;
  }

  console.log("----------Employee Initial Response----------")
  console.log(response)

  // Storing the IDs and Sequence IDs for each record in the payload
  let payloadIds = {}
  for (let i = 0; i < payload.length; i++) {
    payloadIds[payload[i].EmployeeIdentifier] = payload[i].SequenceID
  }

  // Logging each payload record in EVV AZ Table
  let evvIDs = {}
  for (let i = 0; i < payload.length; i++) {
    let evvAZResponse = await processEvvAZTableForEmp(com_id, response.id, payload[i], payload[i].EmployeeIdentifier, evvProcessLogId)
    evvIDs[payload[i].SequenceID] = evvAZResponse.id
  }

  // If call to SanData returns error case
  if (response.status == "FAILED") {
    console.log("\n| INFO | Error by SanData (Employee)")
    updateAZProcessLogTable(response.id, 0, response.failedCount, "FAILED", JSON.stringify(response.data), evvProcessLogId, processID)
    for (let i = 0; i < response.data.length; i++) {
      let currId = response.data[i].EmployeeIdentifier
      let currSeqID = response.data[i].SequenceID
      let error = response.data[i].ErrorMessage ? response.data[i].ErrorMessage : response.messageSummary
      populateAZLogTableForEmp(com_id, invocationTimestamp, response.id, "EMPLOYEE", currId, evvProcessLogId, "FAILED", currSeqID, error, evvIDs[currSeqID], processID)
    }
  }
  else {
    // Status Call
    console.log(`\n| INFO | Waiting ${60000 * 0.001} seconds for employee status response from Sandata`)
    await sleep(60000)

    console.log(`\n| INFO | Attempting to get employee status response from Sandata`)
    let statusResponse = await API.checkStatusEmployee(response.id, auth, headers)

    console.log(`\n| DEBUG | Employee Status Response from Sandata`)
    console.log(statusResponse)

    // Status Call fails case
    if (statusResponse.messageSummary == "The result for the input UUID is not ready yet. Please try again.") {
      let errorMsg = "ERROR: The result for the input UUID is not ready yet. Please try again."
      updateAZProcessLogTable(statusResponse.id, 0, 0, "TRY AGAIN", errorMsg, evvProcessLogId, processID)

      for (let i = 0; i < payload.length; i++) {
        let currId = payload[i].EmployeeIdentifier
        let currSeqID = payload[i].SequenceID
        populateAZLogTableForEmp(com_id, invocationTimestamp, response.id, "EMPLOYEE", currId, evvProcessLogId, "TRY AGAIN", currSeqID, errorMsg, evvIDs[currSeqID], processID)
      }
    }
    else {
      // Logging Failed records in the Log Table
      let failedCount = statusResponse.failedCount

      for (let i = 0; i < statusResponse.data.length; i++) {
        let currId = statusResponse.data[i].EmployeeIdentifier
        let currSeqID = statusResponse.data[i].SequenceID
        let error = statusResponse.data[i].ErrorMessage

        populateAZLogTableForEmp(com_id, invocationTimestamp, response.id, "EMPLOYEE", currId, evvProcessLogId, "FAILED", currSeqID, error, evvIDs[currSeqID], processID)

        delete payloadIds[currId]
      }

      // Logging Success records in the Log Table
      let succeededCount = payload.length - failedCount
      summary.recordsFailed += failedCount;
      summary.recordsSuccessfullySent = summary.recordsSent - summary.recordsFailed;

      for (const empID in payloadIds) {
        populateAZLogTableForEmp(com_id, invocationTimestamp, response.id, "EMPLOYEE", empID, evvProcessLogId, "SUCCESS", payloadIds[empID], '', evvIDs[payloadIds[empID]], processID)
      }

      // Updating the Process Log Table
      updateAZProcessLogTable(response.id, succeededCount, failedCount, statusResponse.status, JSON.stringify(statusResponse.data), evvProcessLogId, processID)
    }
  }
};

//sending customer info
const sendCustomer = async (com_id, UserID, PASSWORD, BusinessEntityID, BusinessEntityMedicaidIdentifier, payloadData) => {
  console.log("EVV AZ (Customer) Scheduler triggered at: " + new Date())
  let summary = {recordsSent: 0, recordsSuccessfullySent: 0, recordsFailed: 0}
  let invocationTimestamp = moment().format('YYYY-MM-DDTHH:mm:ss')
  console.log("\n| INFO | invocationTimestamp of sendEVV_AZ_CustomerDataByScheduler run is", invocationTimestamp)

  let customers = [];
  let ids = new Set(); // Using a Set to track unique ids

  for (let obj of payloadData) {
    if (!ids.has(obj.cus_id)) {
      customers.push(obj);
      ids.add(obj.cus_id);
    }
  }

  const auth = {
    username: UserID,
    password: PASSWORD,
  };

  const headers = {
    account: BusinessEntityID,
  };

  const queryTryAgainLogs = `select * from evv_AZ_log where payloadType = 'CUSTOMER' and status = 'TRY AGAIN' and evvLogComid = ${com_id}`
  let evvTryAgainLogs = await DBSendResponse(queryTryAgainLogs);

  evvTryAgainLogs = evvTryAgainLogs.reduce((accumulator, current) => {
    if (!accumulator.some(item => item.transactionID === current.transactionID)) {
      accumulator.push(current);
    }
    return accumulator;
  }, []);

  try {
    await Promise.all(evvTryAgainLogs.map(async (log) => {
      console.log(`\n| INFO | Status Check from SanData for customers with status 'TRY AGAIN'`);
      let statusResp = await API.checkStatusPatient(log.transactionID, auth, headers);

      console.log(`\n| DEBUG | Customer Status Response from Sandata`);
      console.log(statusResp);

      if (statusResp.messageSummary == "The result for the input UUID is not ready yet. Please try again.") {
        return summary;
      }

      await updateAZProcessLogTable(log.transactionID, statusResp.succeededCount, statusResp.failedCount, statusResp.status, JSON.stringify(statusResp.data), log.processlogID, log.processID)

      await updateAZLogTableSuccess("SUCCESS", '', log.transactionID)

      if (statusResp.status === 'FAILED') {
        console.log(`\n| INFO | Status Check = FAILED`)

        statusResp.data.forEach(async (data) => {
          const currSeqID = data.SequenceID;
          const error = data.ErrorMessage;

          await updateAZLogTableFailed("FAILED", error, currSeqID);
        });
      }
      else if (statusResp.status === 'SUCCESS') {
        console.log(`\n| INFO | Status Check = SUCCESS`)
      }
      else {
        console.log(`\n-*-*-*-*-*-*-*-*-*-*-*-*-`)
      }
    }));
  }
  catch (err) {
    console.log(`| ERROR Failed to do Status Check from SanData for customers with status 'TRY AGAIN' | ${err}`)
  }

  const queryToGetEVVLog = `select * from evv_AZ_log where payloadType = 'CUSTOMER' and status != 'FAILED' and evvLogComid = ${com_id}`;

  let evvLogs = await DBSendResponse(queryToGetEVVLog);

  evvLogs = evvLogs.map((x) => x.custID);

  customers = customers.filter((customer) => !evvLogs.includes(customer.cus_id.toString()));

  let payload = []

  await Promise.all(customers.map(async (client) => {
    const address = client.cus_address.split(":")[0].split(",");
    if (address.length === 4) {
      address.splice(1, 0, '');
    }

    const names = client.cus_name.split(" ");

    if (address.length < 4 || address.length > 6 || names.length < 2) {
      return;
    }

    const record = {
      ProviderIdentification: {
        ProviderQualifier: "MedicaidID",
        ProviderID: BusinessEntityMedicaidIdentifier,
      },
      ClientID: client.cus_id,
      ClientFirstName: names[0],
      ClientLastName: names[names.length - 1],
      ClientQualifier: "ClientCustomID",
      ClientMedicaidID: client.cust_medicaid_id,
      ClientIdentifier: client.cust_medicaid_id,
      MissingMedicaidID: "False",
      SequenceID: SequenceCount,
      ClientCustomID: client.cust_medicaid_id,
      ClientOtherID: "A00" + client.cus_id,
      ClientTimezone: "US/Mountain",
      ClientAddress: [
        {
          ClientAddressType: "Home",
          ClientAddressIsPrimary: true,
          ClientAddressLine1: address[0],
          ClientAddressLine2: address[1],
          ClientCity: address[2],
          ClientState: address[3],
          ClientZip: address[4].length == 5 ? address[4] + "0000" : address[4],
        },
      ],
    };

    SequenceCount = SequenceCount + 1;
    summary.recordsSent += 1;

    payload.push(record);
  }))

  // Populate Initial Process Log Entry
  let evvProcessLogResponse = await populateAZProcessLogTable(com_id, invocationTimestamp, payload.length, 0, 0, "CUSTOMER")
  let evvProcessLogId = evvProcessLogResponse.id
  processID = 'P' + evvProcessLogId

  console.log("----------Customer Payload----------")
  console.log(payload)

  try {
    if (payload.length === 0) {
      console.log(`| No Customer Records to send`)
      updateAZProcessLogTable(204, 0, 0, "NO RECORDS TO SEND", "", evvProcessLogId, processID)
      return summary;
    }
    else {
      var response = await API.uploadPatientData(payload, auth, headers);
    }
  }
  catch (err) {
    console.log(`| ERROR (Customer Payload Submission) | ${err}`)
    await updateAZProcessLogTable(404, 0, 0, "FAILED", "ERROR: Failed to establish connection with SanData", evvProcessLogId, processID)

    // Logging each payload record in EVV AZ Table
    let evvIDs = {}
    for (let i = 0; i < payload.length; i++) {
      let evvAZResponse = await processEvvAZTableForCust(com_id, 404, payload[i], payload[i].ClientID, evvProcessLogId)
      evvIDs[payload[i].SequenceID] = evvAZResponse.id
    }
    for (let i = 0; i < payload.length; i++) {
      let currId = payload[i].ClientID
      let currSeqID = payload[i].SequenceID
      populateAZLogTableForCust(com_id, invocationTimestamp, 404, "CUSTOMER", currId, evvProcessLogId, "FAILED", currSeqID, "ERROR: Failed to establish connection with SanData", evvIDs[currSeqID], processID)
    }
    return summary;
  }

  console.log("----------Customer Initial Response----------")
  console.log(response)

  // Storing the IDs and Sequence IDs for each record in the payload
  let payloadIds = {}
  for (let i = 0; i < payload.length; i++) {
    payloadIds[payload[i].ClientID] = payload[i].SequenceID
  }

  // Logging each payload record in EVV AZ Table
  let evvIDs = {}
  for (let i = 0; i < payload.length; i++) {
    let evvAZResponse = await processEvvAZTableForCust(com_id, response.id, payload[i], payload[i].ClientID, evvProcessLogId)
    evvIDs[payload[i].SequenceID] = evvAZResponse.id
  }

  // If call to SanData returns error case
  if (response.status == "FAILED") {
    console.log("\n| INFO | Error by SanData (Customer)")
    updateAZProcessLogTable(response.id, 0, response.failedCount, "FAILED", JSON.stringify(response.data), evvProcessLogId, processID)
    for (let i = 0; i < response.data.length; i++) {
      let currId = response.data[i].ClientOtherID.substring(3)
      let currSeqID = response.data[i].SequenceID
      let error = response.data[i].ErrorMessage ? response.data[i].ErrorMessage : response.messageSummary
      populateAZLogTableForCust(com_id, invocationTimestamp, response.id, "CUSTOMER", currId, evvProcessLogId, "FAILED", currSeqID, error, evvIDs[currSeqID], processID)
    }
  }
  else {
    // Status Call
    console.log(`\n| INFO | Waiting ${60000 * 0.001} seconds for customer status response from Sandata`)
    await sleep(60000)

    console.log(`\n| INFO | Attempting to get customer status response from Sandata`)
    let statusResponse = await API.checkStatusPatient(response.id, auth, headers)

    console.log(`\n| DEBUG | Customer Status Response from Sandata`)
    console.log(statusResponse)

    // Status Call fails case
    if (statusResponse.messageSummary == "The result for the input UUID is not ready yet. Please try again.") {
      let errorMsg = "ERROR: The result for the input UUID is not ready yet. Please try again."
      updateAZProcessLogTable(statusResponse.id, 0, 0, "TRY AGAIN", errorMsg, evvProcessLogId, processID)

      for (let i = 0; i < payload.length; i++) {
        let currId = payload[i].ClientID
        let currSeqID = payload[i].SequenceID
        populateAZLogTableForCust(com_id, invocationTimestamp, response.id, "CUSTOMER", currId, evvProcessLogId, "TRY AGAIN", currSeqID, errorMsg, evvIDs[currSeqID], processID)
      }
    }
    else {
      // Logging Failed records in the Log Table
      let failedCount = statusResponse.failedCount

      for (let i = 0; i < statusResponse.data.length; i++) {
        let currId = statusResponse.data[i].ClientOtherID.substring(3)
        let currSeqID = statusResponse.data[i].SequenceID
        let error = statusResponse.data[i].ErrorMessage

        populateAZLogTableForCust(com_id, invocationTimestamp, response.id, "CUSTOMER", currId, evvProcessLogId, "FAILED", currSeqID, error, evvIDs[currSeqID], processID)

        delete payloadIds[currId]
      }

      // Logging Success records in the Log Table
      let succeededCount = payload.length - failedCount

      for (const custID in payloadIds) {
        populateAZLogTableForCust(com_id, invocationTimestamp, response.id, "CUSTOMER", custID, evvProcessLogId, "SUCCESS", payloadIds[custID], '', evvIDs[payloadIds[custID]], processID)
      }

      summary.recordsFailed = failedCount;
      summary.recordsSuccessfullySent = summary.recordsSent - summary.recordsFailed;

      // Updating the Process Log Table
      updateAZProcessLogTable(response.id, succeededCount, failedCount, statusResponse.status, JSON.stringify(statusResponse.data), evvProcessLogId, processID)
    }
  }
  return summary
};

//sending visit info
const sendVisit = async (com_id, UserID, PASSWORD, BusinessEntityID, BusinessEntityMedicaidIdentifier, tasks) => {
  console.log("EVV AZ (Visit) Scheduler triggered at: " + new Date())
  let summary = {recordsSent: 0, recordsSuccessfullySent: 0, recordsFailed: 0}
  let invocationTimestamp = moment().format('YYYY-MM-DDTHH:mm:ss')
  console.log("\n| INFO | invocationTimestamp of sendEVV_AZ_VisitDataByScheduler run is", invocationTimestamp)

  const auth = {
    username: UserID,
    password: PASSWORD,
  };

  const headers = {
    account: BusinessEntityID,
  };

  const queryTryAgainLogs = `select * from evv_AZ_log where payloadType = 'VISIT' and status = 'TRY AGAIN' and evvLogComid = ${com_id}`
  let evvTryAgainLogs = await DBSendResponse(queryTryAgainLogs);

  evvTryAgainLogs = evvTryAgainLogs.reduce((accumulator, current) => {
    if (!accumulator.some(item => item.transactionID === current.transactionID)) {
      accumulator.push(current);
    }
    return accumulator;
  }, []);

  try {
    await Promise.all(evvTryAgainLogs.map(async (log) => {
      console.log(`\n| INFO | Status Check from SanData for visits with status 'TRY AGAIN'`);
      let statusResp = await API.checkStatusVisit(log.transactionID, auth, headers);

      console.log(`\n| DEBUG | Visit Status Response from Sandata`);
      console.log(statusResp);

      if (statusResp.messageSummary == "The result for the input UUID is not ready yet. Please try again.") {
        return summary;
      }

      await updateAZProcessLogTable(log.transactionID, statusResp.succeededCount, statusResp.failedCount, statusResp.status, JSON.stringify(statusResp.data), log.processlogID, log.processID)

      await updateAZLogTableSuccess("SUCCESS", '', log.transactionID)

      if (statusResp.status === 'FAILED') {
        console.log(`\n| INFO | Status Check = FAILED`)

        statusResp.data.forEach(async (data) => {
          const currSeqID = data.SequenceID;
          const error = data.ErrorMessage;

          await updateAZLogTableFailed("FAILED", error, currSeqID);
        });
      }
      else if (statusResp.status === 'SUCCESS') {
        console.log(`\n| INFO | Status Check = SUCCESS`)
      }
      else {
        console.log(`\n-*-*-*-*-*-*-*-*-*-*-*-*-`)
      }
    }));
  }
  catch (err) {
    console.log(`| ERROR Failed to do Status Check from SanData for visits with status 'TRY AGAIN' | ${err}`)
  }

  const queryToGetEVVLog = `select * from evv_AZ_log where payloadType = 'VISIT' and status != 'FAILED' and evvLogComid = ${com_id}`;

  let evvLogs = await DBSendResponse(queryToGetEVVLog);

  evvLogs = evvLogs.map((x) => x.visitID);

  tasks = tasks.filter((task) => !evvLogs.includes(task.tas_id.toString()));
  tasks = tasks.filter((task) => (!evvLogs.includes(task.tas_id.toString()) && task.artifacts_present));

  const payerID = {
    "UnitedHealthcare Community Plan": "AZUCP",
    "AHCCCS": "AZCCCS",
    "AZ-DDD": "AZDDD",
    "Arizona Complete Health": "AZACH",
    "Banner- University Family Care": "AZBUFC",
    "Care1st Health Plan": "AZCHP",
    "Magellan Complete Care": "AZMCC",
    "Mercy Care": "AZMYC",
    "Steward Health Choice Arizona": "AZSHC",
    "Dental and Medical Plan": "AZCDMP",
  };

  let payload = []

  await Promise.all(tasks.map(async (task) => {
    let hours = moment(task.checkoutEmpDate).diff(task.empLocdate, 'seconds') / 3600;
    let modifierCodes = task.modifier_code.split(':')

    const record = {
      ProviderIdentification: {
        ProviderQualifier: "MedicaidID",
        ProviderID: BusinessEntityMedicaidIdentifier,
      },
      VisitOtherID: task.tas_id.toString(),
      SequenceID: SequenceCount,
      EmployeeQualifier: "EmployeeSSN",
      EmployeeIdentifier: task.emp_ssn,
      GroupCode: null,
      ClientIDQualifier: "ClientCustomID",
      ClientID: task.cust_medicaid_id,
      ClientOtherID: "A00" + task.cus_id,
      VisitCancelledIndicator: false,
      PayerID: payerID[task.payer_name],
      PayerProgram: "AHCCCS",
      ProcedureCode: task.proc_code,
      Modifier1: modifierCodes[1] ? modifierCodes[1] : null,
      Modifier2: modifierCodes[2] ? modifierCodes[2] : null,
      Modifier3: modifierCodes[3] ? modifierCodes[3] : null,
      Modifier4: modifierCodes[4] ? modifierCodes[4] : null,
      VisitTimeZone: "US/Mountain",
      ScheduleStartTime: moment(task.tas_start_time).utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
      ScheduleEndTime: moment(task.tas_end_time).utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
      BillVisit: task.tas_billable_by_default,
      HoursToBill: hours.toFixed(2),
      ClientVerifiedTimes: true,
      ClientVerifiedTasks: true,
      ClientVerifiedService: true,
      ClientSignatureAvailable: false,
      ClientVoiceRecording: true,
      Calls: [
        {
          CallExternalID: callID.toString(),
          CallDateTime: moment(task.empLocdate).utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
          CallAssignment: "Time In",
          GroupCode: null,
          CallType: "Mobile",
          ProcedureCode: task.proc_code,
          MobileLogin: task.empEmail,
          CallLongitude: task.lon,
          CallLatitude: task.lat,
          ClientIdentifierOnCall: task.cust_medicaid_id,
        },
        {
          CallExternalID: callID.toString(),
          CallDateTime: moment(task.checkoutEmpDate).utc().format("YYYY-MM-DDTHH:mm:ss") + "Z",
          CallAssignment: "Time Out",
          GroupCode: null,
          CallType: "Mobile",
          ProcedureCode: task.proc_code,
          MobileLogin: task.empEmail,
          CallLongitude: task.lon,
          CallLatitude: task.lat,
          ClientIdentifierOnCall: task.cust_medicaid_id,
        },
      ],
    };
    SequenceCount = SequenceCount + 1;
    summary.recordsSent += 1;
    callID = callID + 1;

    payload.push(record);
  }))

  // Populate Initial Process Log Entry
  let evvProcessLogResponse = await populateAZProcessLogTable(com_id, invocationTimestamp, payload.length, 0, 0, "VISIT")
  let evvProcessLogId = evvProcessLogResponse.id

  console.log("----------Visit Payload----------")
  console.log(payload)

  try {
    if (payload.length === 0) {
      console.log(`| No Visit Records to send`)
      updateAZProcessLogTable(204, 0, 0, "NO RECORDS TO SEND", "", evvProcessLogId, processID)
      return summary;
    }
    else {
      var response = await API.uploadVisitData(payload, auth, headers);
    }
  }
  catch (err) {
    console.log(`| ERROR (Visit Payload Submission) | ${err}`)
    await updateAZProcessLogTable(404, 0, 0, "FAILED", "ERROR: Failed to establish connection with SanData", evvProcessLogId, processID)

    // Logging each payload record in EVV AZ Table
    let evvIDs = {}
    for (let i = 0; i < payload.length; i++) {
      let evvAZResponse = await processEvvAZTableForVisit(com_id, 404, payload[i], payload[i].VisitOtherID, evvProcessLogId)
      evvIDs[payload[i].SequenceID] = evvAZResponse.id
    }
    for (let i = 0; i < payload.length; i++) {
      let currId = payload[i].VisitOtherID
      let currSeqID = payload[i].SequenceID
      populateAZLogTableForVisit(com_id, invocationTimestamp, 404, "VISIT", currId, evvProcessLogId, "FAILED", currSeqID, "ERROR: Failed to establish connection with SanData", evvIDs[currSeqID], processID)
    }
    return;
  }

  console.log("----------Visit Initial Response----------")
  console.log(response)

  // Storing the IDs and Sequence IDs for each record in the payload
  let payloadIds = {}
  for (let i = 0; i < payload.length; i++) {
    payloadIds[payload[i].VisitOtherID] = payload[i].SequenceID
  }

  // Logging each payload record in EVV AZ Table
  let evvIDs = {}
  for (let i = 0; i < payload.length; i++) {
    let evvAZResponse = await processEvvAZTableForVisit(com_id, response.id, payload[i], payload[i].VisitOtherID, evvProcessLogId)
    evvIDs[payload[i].SequenceID] = evvAZResponse.id
  }

  // If call to Sandata returns error case
  if (response.status == "FAILED") {
    console.log("\n| INFO | Error by SanData (Visit)")
    updateAZProcessLogTable(response.id, 0, response.failedCount, "FAILED", JSON.stringify(response.data), evvProcessLogId, processID)
    for (let i = 0; i < response.data.length; i++) {
      let currId = response.data[i].VisitOtherID
      let currSeqID = response.data[i].SequenceID
      let error = response.data[i].ErrorMessage ? response.data[i].ErrorMessage : response.messageSummary
      populateAZLogTableForVisit(com_id, invocationTimestamp, response.id, "VISIT", currId, evvProcessLogId, "FAILED", currSeqID, error, evvIDs[currSeqID], processID)
    }
  }
  else {
    // Status Call
    console.log(`\n| INFO | Waiting ${60000 * 0.001} seconds for visit status response from Sandata`)
    await sleep(60000)

    console.log(`\n| INFO | Attempting to get visit status response from Sandata`)
    let statusResponse = await API.checkStatusVisit(response.id, auth, headers)

    console.log(`\n| DEBUG | Visit Status Response from Sandata`)
    console.log(statusResponse)

    // Status Call fails case
    if (statusResponse.messageSummary == "The result for the input UUID is not ready yet. Please try again.") {
      let errorMsg = "ERROR: The result for the input UUID is not ready yet. Please try again."
      updateAZProcessLogTable(statusResponse.id, 0, 0, "TRY AGAIN", errorMsg, evvProcessLogId, processID)

      for (let i = 0; i < payload.length; i++) {
        let currId = payload[i].VisitOtherID
        let currSeqID = payload[i].SequenceID
        populateAZLogTableForVisit(com_id, invocationTimestamp, response.id, "VISIT", currId, evvProcessLogId, "TRY AGAIN", currSeqID, errorMsg, evvIDs[currSeqID], processID)
      }
    }
    else {
      // Logging Failed records in the Log Table
      let failedCount = statusResponse.failedCount

      for (let i = 0; i < statusResponse.data.length; i++) {
        let currId = statusResponse.data[i].VisitOtherID
        let currSeqID = statusResponse.data[i].SequenceID
        let error = statusResponse.data[i].ErrorMessage

        populateAZLogTableForVisit(com_id, invocationTimestamp, response.id, "VISIT", currId, evvProcessLogId, "FAILED", currSeqID, error, evvIDs[currSeqID], processID)

        delete payloadIds[currId]
      }

      // Logging Success records in the Log Table
      let succeededCount = payload.length - failedCount

      summary.recordsFailed += failedCount;
      summary.recordsSuccessfullySent = summary.recordsSent - summary.recordsFailed;

      for (const visitID in payloadIds) {
        populateAZLogTableForVisit(com_id, invocationTimestamp, response.id, "VISIT", visitID, evvProcessLogId, "SUCCESS", payloadIds[visitID], '', evvIDs[payloadIds[visitID]], processID)
      }

      // Updating the Process Log Table
      updateAZProcessLogTable(response.id, succeededCount, failedCount, statusResponse.status, JSON.stringify(statusResponse.data), evvProcessLogId, processID)
    }
  }
  return summary;
};

async function populateAZProcessLogTable(com_id, timestamp, total_records_sent, succeededCount, failedCount, type) {
  let query = `insert into evv_AZ_process_log (evvProcessLogComid, timestamp, total_records_sent, succeededCount, failedCount, payloadType) values (${com_id}, '${timestamp}', '${total_records_sent}', '${succeededCount}', '${failedCount}', '${type}'); SELECT SCOPE_IDENTITY();`
  return (await DBInsertAndReturn(query))
}

async function updateAZProcessLogTable(transactionID, succeededCount, failedCount, status, errors, evvProcessLogId, processID) {
  errors = errors ? errors.replaceAll("'", "''") : null
  let query = `update evv_AZ_process_log set transactionID = '${transactionID}', succeededCount = ${succeededCount}, failedCount = ${failedCount}, status = '${status}', errors = '${errors}', processID = '${processID}' where ProcessLogId=${evvProcessLogId}`
  return await DBUpdate(query)
}

async function populateAZLogTableForEmp(com_id, timestamp, transactionID, type, ID, evvProcessLogId, status, seqID, error, evvID, processID) {
  error = error ? error.replaceAll("'", "''") : null
  let query = `insert into evv_AZ_log (evvLogComid, invocationTimestamp, transactionID, payloadType, empID, processLogID, status, sequenceID, errorMessage, evvID, processID) values (${com_id}, '${timestamp}', '${transactionID}', '${type}', '${ID}', '${evvProcessLogId}', '${status}', '${seqID}', '${error}', '${evvID}', '${processID}'); SELECT SCOPE_IDENTITY();`
  return (await DBInsertAndReturn(query))
}

async function populateAZLogTableForCust(com_id, timestamp, transactionID, type, ID, evvProcessLogId, status, seqID, error, evvID, processID) {
  error = error ? error.replaceAll("'", "''") : null
  let query = `insert into evv_AZ_log (evvLogComid, invocationTimestamp, transactionID, payloadType, custID, processLogID, status, sequenceID, errorMessage, evvID, processID) values (${com_id}, '${timestamp}', '${transactionID}', '${type}', '${ID}', '${evvProcessLogId}', '${status}', '${seqID}', '${error}', '${evvID}', '${processID}'); SELECT SCOPE_IDENTITY();`
  return (await DBInsertAndReturn(query))
}

async function populateAZLogTableForVisit(com_id, timestamp, transactionID, type, ID, evvProcessLogId, status, seqID, error, evvID, processID) {
  error = error ? error.replaceAll("'", "''") : null
  let query = `insert into evv_AZ_log (evvLogComid, invocationTimestamp, transactionID, payloadType, visitID, processLogID, status, sequenceID, errorMessage, evvID, processID) values (${com_id}, '${timestamp}', '${transactionID}', '${type}', '${ID}', '${evvProcessLogId}', '${status}', '${seqID}', '${error}', '${evvID}', '${processID}'); SELECT SCOPE_IDENTITY();`
  return (await DBInsertAndReturn(query))
}

async function updateAZLogTableFailed(status, errors, seqID) {
  errors = errors ? errors.replaceAll("'", "''") : null
  let query = `update evv_AZ_log set status = '${status}', errorMessage = '${errors}' where sequenceID='${seqID}'`
  return await DBUpdate(query)
}

async function updateAZLogTableSuccess(status, errors, transactionID) {
  let query = `update evv_AZ_log set status = '${status}', errorMessage = '${errors}' where transactionID='${transactionID}'`
  return await DBUpdate(query)
}

async function processEvvAZTableForEmp(com_id, transactionID, payload, ID, evvProcessLogId) {
  let query = `insert into evv_AZ (evv_comp_id, transactionID, empID, empPayload, processLogID) values (${com_id}, '${transactionID}', '${ID}','${JSON.stringify(payload)}', '${evvProcessLogId}'); SELECT SCOPE_IDENTITY();`
  return (await DBInsertAndReturn(query))
}

async function processEvvAZTableForCust(com_id, transactionID, payload, ID, evvProcessLogId) {
  let query = `insert into evv_AZ (evv_comp_id, transactionID, custID, custPayload, processLogID) values (${com_id}, '${transactionID}', '${ID}','${JSON.stringify(payload)}', '${evvProcessLogId}'); SELECT SCOPE_IDENTITY();`
  return (await DBInsertAndReturn(query))
}

async function processEvvAZTableForVisit(com_id, transactionID, payload, ID, evvProcessLogId) {
  let query = `insert into evv_AZ (evv_comp_id, transactionID, visitID, visitPayload, processLogID) values (${com_id}, '${transactionID}', '${ID}','${JSON.stringify(payload)}', '${evvProcessLogId}'); SELECT SCOPE_IDENTITY();`
  return (await DBInsertAndReturn(query))
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  sendEVV_AZ_Scheduler,
};