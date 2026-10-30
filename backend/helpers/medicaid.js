const axios = require("axios");
const medicaidData = require("../files/medicaid/data.json");
const {
  generateMedicaidJson,
  generateTransactionObj,
  generateMedicaidJsonForMultiple,
  generateMedicaidJsonForMultipleAZ,
  generateTransactionObjAZ,
} = require("../files/medicaid/medicaid");
const moment = require("moment");
const db = require("../models/indexSQL.js");
const schedule = require('node-schedule');
const {
  DBinsertSendID,
  DBinsert,
  DBUpdate,
  DBSendResponse,
  DBinsertSendResponse,
  DBInsertAndReturn,
  generateInsertSQL,
} = require("../queries/commonQueries");
const { response, query } = require("express");
const { map, columns } = require("../models/indexSQL.js");
const { assign } = require("nodemailer/lib/shared");
const path = require("path");
const { CONTAINER_NAME, BLOB_KEY, CLAIM_MD_API_KEY } = require("../config");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
} = require("@azure/storage-blob");
var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require("@segment/analytics-node");
const { generateSQLText } = require("../utils/validation.js");
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

// acount information
const account = "fieldworkblob";
const accountKey = BLOB_KEY;

// storage key and service client generation
const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
const blobServiceClient = new BlobServiceClient(
  `https://${account}.blob.core.windows.net`,
  sharedKeyCredential
);

// container information
const containerName = CONTAINER_NAME;
const urlPrefix = `https://fieldworkblob.blob.core.windows.net/${containerName}/`;
// const sample837json = {
//     "ISA": {
//         AuthorizationInformationQualifier_1: "00",
//         "AuthorizationInformation_2": "          ",
//         "SecurityInformationQualifier_3": "00",
//         "SecurityInformation_4": "          ",
//         "SenderIDQualifier_5": "ZZ",
//         "InterchangeSenderID_6": "123456789012345",
//         "ReceiverIDQualifier_7": "ZZ",
//         "InterchangeReceiverID_8": "123456789012346",
//         "InterchangeDate_9": "061015",
//         "InterchangeTime_10": "1705",
//         "InterchangeControlStandardsIdentifier_11": ">",
//         "InterchangeControlVersionNumber_12": "00501",
//         "InterchangeControlNumber_13": "000010216",
//         "AcknowledgementRequested_14": "0",
//         "UsageIndicator_15": "T",
//         "ComponentElementSeparator_16": ":"
//       },
//     IEA: [
//         'IEA',
//         '',
//         ''
//     ],
//     GS: [
//         'GS',
//         1: 'HC',
//         2: '',
//         3: '610515',
//         4: moment().format('YYMMDD'),
//         5: moment().format('HHmm'),
//         6: '',
//         7: '',
//         8: '005010X222A1',
//     ],
//     GE: {
//         1: '',
//         2: ''
//     },
//     ST: {
//         1: '837',
//         2: '',
//         3: '005010X222A1'
//     }
// }

exports.get837pSample = async function (req, res) {
  // let resultEDI = ''
  // Envelope
  // resultEDI +=
};

exports.parse999Response = async function (req, res) {
  const fs = require("fs");

  try {
    const data = fs.readFileSync(
      "9904999_011570181_01-13-23_17_23_2_490.a97",
      "utf8"
    );
    let chunkedData = data.split("~");
    let claimCN,
      errorHeader,
      headerErrorCode,
      errorSeg,
      segmentErrorCode,
      finalStatus;
    let codes = require("../files/medicaid/999ErrorCodes.json");
    let accepted = [],
      rejected = [];
    // console.log(codes);
    for (let chunk of chunkedData) {
      let elements = chunk.split("*");
      // console.log(elements)
      if (elements[0] === "AK2") {
        claimCN = elements[2];
      } else if (elements[0] === "IK3") {
        errorHeader = elements[1];
        headerErrorCode = codes[0][elements[0]][elements[4]];
        // console.log(headerErrorCode);
      } else if (elements[0] === "IK4") {
        errorSeg = elements[4];
        segmentErrorCode = codes[0][elements[0]][elements[3]];
        // console.log(segmentErrorCode);
      } else if (elements[0] === "IK5") {
        // console.log(claimCN,errorHeader,headerErrorCode,errorSeg,segmentErrorCode)
        finalStatus = elements[1];
        let statusObj = {
          claimCN: claimCN,
          errors:
            errorHeader +
            " - " +
            headerErrorCode +
            ", " +
            errorSeg +
            " - " +
            segmentErrorCode,
          finalStatus: finalStatus === "A" ? "Accepted" : "Rejected",
        };
        if (finalStatus === "A") {
          accepted.push(statusObj);
        } else {
          rejected.push(statusObj);
        }
        claimCN = "None";
        errorHeader = "None";
        headerErrorCode = "None";
        errorSeg = "None";
        segmentErrorCode = "None";
      }
    }
    let statusQuery = "UPDATE Claim SET Status = CASE ",
      errorUpdateQuery = "UPDATE Claim SET errDescription = CASE ";
    let acceptedIDs = "(",
      rejectedIDs = "(",
      aIDs = accepted.length,
      rIDs = rejected.length,
      allIds = "(";
    accepted.forEach((obj) => {
      acceptedIDs += String(Number(obj.claimCN)) + ",";
      allIds += String(Number(obj.claimCN)) + ",";
    });
    acceptedIDs = acceptedIDs.substring(0, acceptedIDs.length - 1) + ")";
    rejected.forEach((obj) => {
      rejectedIDs += String(Number(obj.claimCN)) + ",";
      allIds += String(Number(obj.claimCN)) + ",";
    });
    rejectedIDs = rejectedIDs.substring(0, rejectedIDs.length - 1) + ")";
    allIds = allIds.substring(0, allIds.length - 1) + ")";
    if (aIDs !== 0) {
      statusQuery += "WHEN claim_ID IN " + acceptedIDs + ` THEN '999Accepted' `;
    }
    if (rIDs !== 0) {
      statusQuery += "WHEN claim_ID IN " + rejectedIDs + ` THEN '999Rejected' `;
    }
    statusQuery += "END WHERE claim_ID IN " + allIds;
    rejected.forEach((obj) => {
      errorUpdateQuery +=
        "WHEN claim_ID = " +
        String(Number(obj.claimCN)) +
        ` THEN '${obj.errors}' `;
    });
    errorUpdateQuery += "END ";
    errorUpdateQuery += "WHERE claim_ID IN " + rejectedIDs;
    const resp = await DBUpdate(statusQuery);
    const eUpdate = await DBUpdate(errorUpdateQuery);
    // console.log(eUpdate)
    return res.json({ data: chunkedData });
  } catch (err) {
    console.error(err);
  }
};

getEDIfromJsonData = async function (req, entries) {
  try {
    const uploadedByID = req.body.emp_id;

    var transactions = [];
    let state = "NJ";
    const billingData = await getBillingInfo(state, "NJMCD");
    const companyData = await getCompanyInfo(req.body.comp_id);

    entries = entries.sort((a, b) => a.claim_ID - b.claim_ID);
    // console.log(entries)

    let totalClaimAmount = 0;

    for (var i = 0; i < entries.length; i++) {
      var payload = getPayload(entries[i]);
      totalClaimAmount += parseFloat(payload.claimAmount.amount);
      payload["billingData"] = billingData;
      payload["companyData"] = companyData;
      transactions.push(generateTransactionObj(payload));
    }

    console.log(transactions);

    const multipleEDIJson = generateMedicaidJsonForMultiple(transactions);
    setNumOfSegments(multipleEDIJson.Groups[0].Transactions);
    convertToEDI(multipleEDIJson);

    // console.log("here")
    await generateDAT(EDI);
    const upRes = await uploadIt(uploadedByID);
    let empId = req.body.emp_id,
      empName = req.body.empName,
      empCompanyId = req.body.comp_id,
      companyName = req.body.companyName;
    if (empId && empName && transactions && empCompanyId && companyName) {
      analytics.track({
        userId: String(empId),
        event: "Claims submitted",
        context: {
          groupId: empCompanyId,
        },
        properties: {
          submittedBy: empName,
          claims: String(transactions.length),
          companyId: empCompanyId,
          companyName: companyName,
          time: moment().format("MM/DD/YYYY HH:mm:ss"),
          amountClaimed: totalClaimAmount,
        },
      });
      console.log("logged to segment successfully");
    }
    return upRes;
  } catch (error) {
    const statusCode = 400;
    const errorMessage = "Something went wrong!";

    if (req.body.emp_id && req.body.empName && req.body.comp_id && req.body.companyName) {
      analytics.track({
        userId: String(req.body.emp_id),
        event: "Claims submission failed",
        context: {
          groupId: req.body.comp_id,
        },
        properties: {
          submittedBy: req.body.empName,
          companyId: req.body.comp_id,
          companyName: req.body.companyName,
          time: moment().format("MM/DD/YYYY HH:mm:ss"),
        },
      });
    }

    return { sucess: false, message: errorMessage };
  }
};

const generateDAT = async (content) => {
  var fs = require("fs").promises;
  try {
    await fs.writeFile("T9904999.dat", content);
    console.log("Saved!");
  } catch (err) {
    console.log(err);
  }
};

const uploadIt = async (uploadedByID) => {
  var fs = require("fs");
  try {
    let buffer = await fs.readFileSync(
      "T9904999.dat",
      "utf-8",
      function (err, buffer) {}
    );
    Buffer.isBuffer(buffer);
    let assignedFileName = "";
    const IDQuery = "SELECT MAX(id) FROM artifacts;";
    const fileType = "dat";
    const filenamesQuery = `select file_name from [dbo].[artifacts] where file_name like '%9904999.dat'`;
    let fileNames = await DBinsertSendResponse(filenamesQuery);
    fileNames = fileNames.map((obj) => obj.file_name);
    const alpha = Array.from(Array(26)).map((e, i) => i + 65);
    const fullFileNames = alpha.map(
      (x) => String.fromCharCode(x) + "9904999.dat"
    );
    let counts = {};
    fullFileNames.forEach((ele) => {
      counts[ele] = 0;
    });
    fileNames.forEach((ele) => {
      counts[ele] += 1;
    });
    counts = Object.entries(counts);
    counts.sort((a, b) => (a[1] != b[1] ? a[1] - b[1] : a[0][0] - b[0][0]));
    assignedFileName = counts[0][0];
    let id = await DBinsertSendResponse(IDQuery);
    id = id[0][""];
    id += 1;
    id += path.extname("T9904999.dat");

    art_url = urlPrefix + id;
    console.log(art_url);

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(id);
    // console.log(blockBlobClient._name)
    console.log("\nUploading to Azure storage as blob:\n\t", id);

    const options = { blobContentType: "application/" + fileType };
    const uploadBlobResponse = await blockBlobClient.upload(
      buffer,
      buffer.length,
      { blobHTTPHeaders: options }
    );
    console.log(
      "Blob was uploaded successfully. requestId: ",
      uploadBlobResponse.requestId
    );
    console.log(uploadBlobResponse);
    if (uploadBlobResponse.requestId) {
      //task_id = null
      //emp_id = current user
      //customer_id = null
      const query =
        "insert into artifacts(file_name,url,employee_id,show,submitted) values (" +
        "'" +
        assignedFileName +
        "'," +
        "'" +
        art_url +
        "'," +
        "" +
        uploadedByID +
        "," +
        "'" +
        true +
        "'," +
        "CURRENT_TIMESTAMP); SELECT SCOPE_IDENTITY();";
      console.log(query);

      // DBinsert(res, query);
      const addedArt = await DBinsertSendID(query);
      console.log(addedArt);
      if (addedArt) {
        return {
          message: "Add Artifact Success",
          code: 200,
          id: assignedFileName.slice(0, 8),
          url: art_url,
        };
      } else {
        return { message: "Add Artifact Failed", code: 500 };
      }
    }
  } catch (err) {
    console.log(err);
    return { message: "Add Artifact Failed", code: 500 };
  }
};

const getPayload = (obj) => {
  // return {
  //   customerData: {
  //     subscriberFirstName: "Jonathan", //Patient First Name
  //     subscriberLastName: "Doe", //Patient Last Name
  //     dob: "1998-06-24",
  //     subscriberGender: "M",
  //     ICD_10: "A0101", //ICD_10/diagnosis code
  //     medicaidID: "009955664421", //medicaid ID
  //     address: "4001 E Greenway Rd",
  //     city: "Phoenix",
  //     state: "AZ",
  //     zip: "850324748",
  //     priorAuthorization: "1551689772",
  //     relationship: "18", // get the map from claimmd field list
  //   },
  //   taskData: {
  //     taskId: "task_id",
  //     taskDOS:
  //       moment(obj.startDate).utc().format("YYYYMMDD") +
  //       "-" +
  //       moment(obj.endDate).utc().format("YYYYMMDD"),
  //     taskStartDate: "2024-06-05",
  //     taskEndDate: "2024-06-20",
  //     placeOfServiceCode: "09",
  //   },
  //   claimAmount: {
  //     amount: "45",
  //     units: "1",
  //   },
  //   procedureCode: "T2024",
  //   modifier1: "HI",
  //   modifier2: "52"
  // };
  var finalProcCode = obj.procedureCode;
  if (String(obj.procedureModifierCode || '').trim() !== '') {
    var codeModifiers = obj.procedureModifierCode.replaceAll("/", ":");
    finalProcCode = finalProcCode + ":" + codeModifiers;
  }

  let codes = finalProcCode.split(":");
  let claimmdProcCode = {
    procedureCode: codes[0],
  }
  let modNum = 1;
  for (let mod of codes.slice(1)) {
    claimmdProcCode[`modifier${modNum}`] = mod;
    modNum += 1;
  }

  var zeros = "000000000000";
  var paddedMedicaidID =
    obj.memberMedicaid.length <= 12
      ? zeros.substring(0, 12 - obj.memberMedicaid.length) + obj.memberMedicaid
      : obj.memberMedicaid.substring(0, 12);
  var paddedControlNum =
    String(obj.claim_ID).length <= 9
      ? zeros.substring(0, 9 - String(obj.claim_ID).length) +
        String(obj.claim_ID)
      : String(obj.claim_ID).substring(0, 9);



  return {
    customerData: {
      controlNumber: paddedControlNum,
      customerId: obj.DDDID,
      subscriberFirstName: obj.FirstName, //Patient First Name
      subscriberLastName: obj.LastName, //Patient Last Name
      subscriberDOB: moment(obj.DateOfBirth).utc().format("YYYYMMDD"), //Patient DOB
      dob: moment(obj.DateOfBirth).utc().format("YYYY-MM-DD"),
      subscriberGender: obj.Gender, //Patient Gender
      accountNumber: obj.DDDID, //Patient DDDID
      priorAuthorization: obj.priorAuth, //prior authorization number
      ICD_10: obj.DiagnosisCode, //ICD_10/diagnosis code
      medicaidID: paddedMedicaidID, //medicaid ID
      address: obj.patientAddrLine1,
      city: obj.patientCity,
      state: obj.patientState,
      zip: obj.patientZip,
      relationship: obj.patientRel,
    },
    taskData: {
      taskId: "task_id",
      claimId: String(obj.claim_ID),
      taskDOS:
        moment(obj.startDate).utc().format("YYYYMMDD") +
        "-" +
        moment(obj.endDate).utc().format("YYYYMMDD"),
      taskStartDate: moment(obj.startDate).utc().format("YYYY-MM-DD"),
      taskEndDate: moment(obj.endDate).utc().format("YYYY-MM-DD"),
      placeOfServiceCode: obj.placeOfServiceCode,
      facilityTypeCode: obj.facilityTypeCode,
    },
    claimAmount: {
      amount: String(obj.authAmount),
      units: String(obj.authUnits),
    },
    procedureCode: finalProcCode,
    claimmdProcCode: claimmdProcCode,
    payerId: obj.payerId,
  };
};

const getObjects = async (file) => {
  var fs = require("fs").promises;
  var dataArray = [];

  const data = await fs.readFile(file, "utf8");
  var arr = data
    .replaceAll('"', "")
    .replaceAll(" ", "")
    .replaceAll("\r", "")
    .split("\n");
  var fields = arr[0].split(",");
  for (var i = 1; i < arr.length; i++) {
    var obj = {};
    var tmp = arr[i].split(",");
    if (tmp.length != fields.length) {
      continue;
    }
    for (j = 0; j < fields.length; j++) {
      obj[fields[j]] = tmp[j];
    }
    dataArray.push(obj);
  }
  return dataArray;
};

readCSV = async function () {
  const dataArray = await getObjects("tmpFieldCSV.csv");
  return dataArray;
};

const getProcedureCode = async (taskId) => {
  const procedureCodeQuery = `select procProcCode,procModifierCode from procedure_code inner join task 
  on procedure_code.procTaskType = task.tas_type where task.tas_id = ${taskId}`;

  const [procedureCode] = await DBSendResponse(procedureCodeQuery);

  const procedureCodeFinal =
    procedureCode.procProcCode.toString() +
    (procedureCode.procModifierCode
      ? procedureCode.procModifierCode.toString()
      : "");

  return procedureCodeFinal;
};

const getCompanyInfo = async (comp_id) => {
  const companyInfoQuery = `select com_name,com_taxid,loc_addr_line1,loc_addr_line2,loc_city,loc_state,ZIP9,NPI,TaxonomyCode
  from company
  inner join location 
  on company.com_id = location.loc_company_id and company.com_id=${comp_id} and location.loc_type = 'Company'`;
  const [companyInfo] = await DBSendResponse(companyInfoQuery);

  let companyName = String(companyInfo.com_name).trim();
  let companyTaxID = String(companyInfo.com_taxid).trim();
  let address = String(
    companyInfo.loc_addr_line1 + " " + companyInfo.loc_addr_line2
  ).trim().replaceAll(",","");
  let city = String(companyInfo.loc_city).trim();
  let state = String(companyInfo.loc_state).trim();
  let zip = String(companyInfo.ZIP9).trim();
  let npi = String(companyInfo.NPI).trim();
  let taxonomyCode = String(companyInfo.TaxonomyCode).trim();

  const companyPayload = {
    companyName: companyName,
    companyTaxID: companyTaxID,
    address: address,
    city: city,
    state: state,
    zip: zip,
    npi: npi,
    taxonomyCode: taxonomyCode,
  };

  console.log(companyPayload);

  // const companyPayload = {
  //     companyName: 'Caring for your needs support services',
  //     companyTaxID: '824517074',
  //     address: '309 Fellowship Road, Suite-200',
  //     city: 'Mount Laurel',
  //     state: 'NJ',
  //     zip: '080541234',
  //     npi: '1861994634',
  //     taxonomyCode: '251B00000X',
  //   };
  // console.log(companyPayload);
  return companyPayload;
};

const getBillingInfo = async (state, payer) => {
  if (state === "AZ") {
    const receiverAgencyName = "HAR_837_Upload";
    const receiverID = "HAR_837_Upload";
    const submitterName = "Fieldworker Inc.";
    const submitterID = "9904999";

    const billingPayload = {
      receiverAgencyName,
      receiverID,
      submitterName,
      submitterID,
    };

    return billingPayload;
  } else if (state === "NJ" && payer === "NJMCD") {
    const billingInfoQuery = `select receiverAgencyName,receiverID,submitterName,submitterID from BillingDetails where state = '${state}'`;
    const [billingInfo] = await DBSendResponse(billingInfoQuery);
  
    const receiverAgencyName = String(billingInfo.receiverAgencyName).trim();
    const receiverID = String(billingInfo.receiverID).trim();
    const submitterName = String(billingInfo.submitterName).trim();
    const submitterID = String(billingInfo.submitterID).trim();
  
    const billingPayload = {
      receiverAgencyName,
      receiverID,
      submitterName,
      submitterID,
    };
    return billingPayload;
  }

  const billingInfoQuery = `select d.id, d.payer_state, p.claimMd_payerId from def_payer_state as d join payer as p on d.payer_id = p.payer_id where d.payer_state = '${state}'`;
  const billingInfo = await DBSendResponse(billingInfoQuery);
  console.log(billingInfo, billingInfoQuery);

  const payer_id = String(billingInfo.payer_id).trim();
  const id = String(billingInfo.id).trim();
  const payer_state = String(billingInfo.payer_state).trim();

  const billingPayload = {
    payer_id,
    id,
    payer_state
  };

  return billingPayload;
};

const getCustomerInfo = async (taskId) => {
  const customerQuery = `with proId as (select tas_pro_id from task where tas_id = '${taskId}'),
  customerId as (select pro_customer_id from project, proId where project.pro_id = proId.tas_pro_id)
  
  select cus_id,cus_name,dob,gender,medicaid_id from customer, customerId where customer.cus_id = customerId.pro_customer_id`;

  const [customerData] = await DBSendResponse(customerQuery);

  const customerId = customerData?.cus_id;
  const customerName = customerData?.cus_name?.split(" ");
  const subscriberFirstName =
    customerName && customerName[0] ? customerName[0] : "";
  const subscriberLastName =
    customerName && customerName[1] ? customerName[1] : "";
  const subscriberDOB = moment.utc(customerData.dob).format("YYYYMMDD");
  const subscriberGender = customerData.gender;
  const accountNumber = String(customerId);
  const priorAuthorization = "1550747531";
  const ICD_10 = "F32.2";
  const medicaidID =
    String(customerData.medicaid_id).length != 12
      ? "0" + String(customerData.medicaid_id)
      : String(customerData.medicaid_id);

  const customerPayload = {
    customerId,
    subscriberFirstName,
    subscriberLastName,
    subscriberDOB,
    subscriberGender,
    accountNumber,
    priorAuthorization,
    ICD_10,
    medicaidID,
  };

  return customerPayload;
};

var fieldValues = [
  "ST",
  "BHT_BeginningOfHierarchicalTransaction",
  "NM1_SubmitterName",
  "PER_SubmitterEDIContactInformation",
  "NM1_ReceiverName",
  "HL_BillingProviderHierarchicalLevel",
  "PRV_BillingProviderSpecialtyInformation",
  "NM1_BillingProviderName",
  "N3_BillingProviderAddress",
  "N4_BillingProviderCity_State_ZIPCode",
  "REF_BillingProviderTaxIdentification",
  "NM1_Pay_AddressName",
  "N3_Pay_ToAddress_ADDRESS",
  "REF_ClaimPriorAuthorization",
  "N4_Pay_AddressCity_State_ZIPCode",
  "HL_SubscriberHierarchicalLevel",
  "SBR_SubscriberInformation",
  "NM1_SubscriberName",
  "DMG_SubscriberDemographicInformation",
  "NM1_PayerName",
  "CLM_ClaimInformation",
  "HI_HealthCareDiagnosisCode",
  "LX_ServiceLineNumber",
  "SV1_ProfessionalService",
  "DTP_Date_ServiceDate",
];

checkArray = function (arr) {
  let numOfEntries = 0;
  for (var i = 0; i < arr.length; i++) {
    if (
      typeof arr[i] === "object" &&
      arr[i] !== null &&
      !Array.isArray(arr[i])
    ) {
      numOfEntries += getEntries(arr[i]);
    } else if (Array.isArray(arr[i])) {
      numOfEntries += checkArray(arr[i]);
    }
  }
  return numOfEntries;
};

getEntries = function (obj) {
  let numOfEntries = 0;

  Object.keys(obj).forEach((key) => {
    if (fieldValues.includes(String(key))) {
      numOfEntries += 1;
    } else {
      if (Array.isArray(obj[key])) {
        numOfEntries += checkArray(obj[key]);
      } else if (
        typeof obj[key] === "object" &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        numOfEntries += getEntries(obj[key]);
      }
    }
  });

  return numOfEntries;
};

setNumOfSegments = function (transactions) {
  // console.log('here')
  for (let i = 0; i < transactions.length; i++) {
    let currObj = transactions[i];
    let numOfSegments = getEntries(currObj);
    numOfSegments += 1;
    // console.log(numOfSegments)
    currObj.SE.NumberofIncludedSegments_01 = String(numOfSegments);
  }
};

const getEmployeeName = async (taskId) => {
  const employeeQuery = `select emp_first_name,emp_last_name  from employee, (select tas_emp_id from task where tas_id = '${taskId}') as empId where employee.emp_id = empId.tas_emp_id`;

  const [employeeData] = await DBSendResponse(employeeQuery);

  return employeeData?.emp_first_name + " " + employeeData?.emp_last_name;
};

const getTaskData = async (taskId) => {
  const taskQuery = `select * from task where tas_id = '${taskId}'`;
  const [taskData] = await DBSendResponse(taskQuery);

  const startDate = moment(taskData?.tas_start_date).format("YYYYMMDD");

  const taskPayload = {
    taskId: taskId,
    taskCase: taskData?.tas_description,
    taskDOS: startDate,
    taskService: taskData?.tas_type + " " + taskData?.tas_title,
  };
  return taskPayload;
};

const getClaimAmount = async (taskId) => {
  const taskTimeQuery = `select t.tas_id, t.tas_type , p.pro_customer_id, l.empLocdate, l.checkoutEmpDate
  from project as p inner join task as t 
  on p.pro_id=t.tas_pro_id inner join customer as c 
  on p.pro_customer_id=c.cus_id inner join employee as e 
  on t.tas_emp_id=e.emp_id inner join empLocate as l 
  on t.tas_id = l.taskId
  where (t.tas_type LIKE '%Visit') and 
  t.tas_is_active=1 and 
  t.tas_billable_by_default=1 and 
  tas_id = '${taskId}'
  `;

  const procCodeQuery = `
    select procProcCode,procUnitOfService, procTaskType, tas_id, tas_type  from [dbo].[procedure_code] , task 
     where task.tas_id = '${taskId}'
     and procedure_code.procTaskType = task.tas_type`;

  const [claimPayload] = await DBSendResponse(taskTimeQuery);
  const procCodeData = await DBSendResponse(procCodeQuery);

  const DDDTierQuery = `select DDD_tier from customer where cus_id = ${claimPayload.pro_customer_id}`;

  let DDDTier = (await DBSendResponse(DDDTierQuery))[0].DDD_tier;

  if (DDDTier === undefined || DDDTier === null) {
    // TODO DEFAULTS FOR PROCEDURE CODES
    if (procCodeData[0].procProcCode === "H2021") {
      DDDTier = "Base";
    } else if (procCodeData[0].procProcCode === "T2024") {
      DDDTier = "PP/PM";
    } else if (
      procCodeData[0].procProcCode === "H2015" ||
      procCodeData[0].procProcCode === "T2021" ||
      procCodeData[0].procProcCode === "H2016"
    ) {
      DDDTier = "A";
    } else if (procCodeData[0].procProcCode === "H2014") {
      DDDTier = "Base";
    } else if (procCodeData[0].procProcCode === "H0004") {
      DDDTier = "Assess";
    } else if (procCodeData[0].procProcCode === "H0005") {
      DDDTier = "Monitor";
    }
  }

  let rate = 0;
  try {
    const rateQuery = `select rate from billingrates where tier='${DDDTier}' AND procProcCode='${procCodeData[0].procProcCode}'`;
    rate = (await DBSendResponse(rateQuery))[0].rate;
  } catch {
    rate = 0;
  }

  const minutes = moment(claimPayload.checkoutEmpDate).diff(
    claimPayload.empLocdate,
    "minutes"
  );
  let billingUnits = 1;
  if (procCodeData[0].procUnitOfService === "1 Hour") {
    billingUnits = Math.ceil(minutes / 60);
  } else if (procCodeData[0].procUnitOfService === "15 Minutes") {
    billingUnits = Math.ceil(minutes / 15);
  }

  const amount = (rate * billingUnits).toString();
  const units = billingUnits.toString();
  const claimAmountPayload = {
    amount,
    units,
  };
  return claimAmountPayload;
};
let EDI = "";

const appendString = (prefix, payload) => {
  EDI += prefix;
  for (const i in payload) {
    if (typeof payload[i] === "string") {
      i === "IndustryCode_02" ? (EDI += ":") : (EDI += "*");
      EDI += payload[i];
    } else {
      for (const j in payload[i]) {
        if (
          j !== "FacilityTypeCode_01" &&
          j !== "ProductorServiceIDQualifier_01" &&
          j !== "DiagnosisCodePointer_01" &&
          j !== "CodeListQualifierCode_01"
        ) {
          EDI += ":";
        } else {
          EDI += "*";
        }

        EDI += payload[i][j];
      }
    }
  }
  EDI += "~";
  return EDI;
};

const convertToEDI = (ediJson) => {
  EDI = "";
  for (const k in ediJson) {
    switch (k) {
      case "ISA": {
        const headerPayload = ediJson[k];
        appendString("ISA", headerPayload);
        break;
      }
      case "Groups": {
        const groupLevel = ediJson[k];
        const gsLevel = groupLevel[0].GS;
        appendString("GS", gsLevel);

        for (var i = 0; i < groupLevel[0].Transactions.length; i++) {
          const stLevel = groupLevel[0].Transactions[i].ST;
          appendString("ST", stLevel);

          const bhtLevel =
            groupLevel[0].Transactions[i]
              .BHT_BeginningOfHierarchicalTransaction;
          appendString("BHT", bhtLevel);

          const nm1Level = groupLevel[0].Transactions[i].AllNM1;

          // Inside All NM1
          // Loop1000A
          const nm1SubmitterName = nm1Level.Loop1000A.NM1_SubmitterName;
          appendString("NM1", nm1SubmitterName);

          const nm1SubmitterContactInfo =
            nm1Level.Loop1000A.PER_SubmitterEDIContactInformation[0];
          appendString("PER", nm1SubmitterContactInfo);

          // Loop1000A
          const nm1ReceiverName = nm1Level.Loop1000B.NM1_ReceiverName;
          appendString("NM1", nm1ReceiverName);

          // Loop2000A
          const loop2000A = groupLevel[0].Transactions[i].Loop2000A[0];
          const hlBillProvideHL = loop2000A.HL_BillingProviderHierarchicalLevel;
          appendString("HL", hlBillProvideHL);

          const prvBillProviderInfo =
            loop2000A.PRV_BillingProviderSpecialtyInformation;
          if (prvBillProviderInfo) {
            appendString("PRV", prvBillProviderInfo);
          }

          // Loop2000A => ALL NM1
          // Loop2010AA
          const loop2010AA = loop2000A.AllNM1.Loop2010AA;

          const loop2010AABillProviderName = loop2010AA.NM1_BillingProviderName;
          appendString("NM1", loop2010AABillProviderName);

          const loop2010AABillProviderAddress =
            loop2010AA.N3_BillingProviderAddress;
          appendString("N3", loop2010AABillProviderAddress);

          const loop2010AABillProviderStateCity =
            loop2010AA.N4_BillingProviderCity_State_ZIPCode;
          appendString("N4", loop2010AABillProviderStateCity);

          const loop2010AABillProviderTaxID =
            loop2010AA.AllREF.REF_BillingProviderTaxIdentification;
          appendString("REF", loop2010AABillProviderTaxID);

          // Loop2010AB
          // const loop2010AB = loop2000A.AllNM1.Loop2010AB

          // const payerAddressName = loop2010AB.NM1_Pay_AddressName
          // appendString('NM1', payerAddressName)

          // const payerAddressAddress = loop2010AB.N3_Pay_ToAddress_ADDRESS
          // appendString('N3', payerAddressAddress)

          // const payerAddressCityState = loop2010AB.N4_Pay_AddressCity_State_ZIPCode
          // appendString('N4', payerAddressCityState)

          // Loop2000B
          const loop2000B = loop2000A.Loop2000B[0];
          const subscriberHierarchicalHL =
            loop2000B.HL_SubscriberHierarchicalLevel;
          appendString("HL", subscriberHierarchicalHL);

          const subscriberInfo = loop2000B.SBR_SubscriberInformation;
          appendString("SBR", subscriberInfo);

          // Loop2000B AllNM1
          const loop2010BA = loop2000B.AllNM1.Loop2010BA;

          const subscriberName = loop2010BA.NM1_SubscriberName;
          appendString("NM1", subscriberName);

          const subscriberAddress = loop2010BA.N3_SubscriberAddress;
          if (subscriberAddress) {
            appendString("N3", subscriberAddress);
          }

          const subscriberCityStateZip =
            loop2010BA.N4_SubscriberCity_State_ZIPCode;
          if (subscriberCityStateZip) {
            appendString("N4", subscriberCityStateZip);
          }

          const subscriberDemoInfo =
            loop2010BA.DMG_SubscriberDemographicInformation;
          appendString("DMG", subscriberDemoInfo);

          // loop2010BB AllNM1
          const loop2010BB = loop2000B.AllNM1.Loop2010BB;
          const payerName = loop2010BB.NM1_PayerName;
          appendString("NM1", payerName);

          // loop2300
          const loop2300 = loop2000B.Loop2000C[0].Loop2300[0];
          const claimInfo = loop2300.CLM_ClaimInformation;
          appendString("CLM", claimInfo);

          const refPriorAuth = loop2300.AllREF.REF_ClaimPriorAuthorization;
          appendString("REF", refPriorAuth);

          const healthCareDiagnosisCode =
            loop2300.AllHI.HI_HealthCareDiagnosisCode;
          appendString("HI", healthCareDiagnosisCode);

          // loop2400
          const loop2400 = loop2300.Loop2400;

          for (const j in loop2400) {
            if (loop2400[j].LX_ServiceLineNumber) {
              appendString("LX", loop2400[j].LX_ServiceLineNumber);
            }
            if (loop2400[j].SV1_ProfessionalService) {
              appendString("SV1", loop2400[j].SV1_ProfessionalService);
            }
            if (loop2400[j].AllDTP.DTP_Date_ServiceDate) {
              appendString("DTP", loop2400[j].AllDTP.DTP_Date_ServiceDate);
            }
          }

          const se = groupLevel[0].Transactions[i].SE;
          appendString("SE", se);
        }

        const geTailers = groupLevel[0].GETrailers[0];
        appendString("GE", geTailers);
        break;
      }
      case "IEATrailers": {
        const ieaTrailers = ediJson[k][0];
        appendString("IEA", ieaTrailers);
        break;
      }

      default:
        break;
    }
  }
};

const getEDImultiple = (data) => {};

exports.getEDIfromJsonCSV = async function (req, res) {
  try {
    const entries = await readCSV();

    var transactions = [];
    let state = "NJ";
    const billingData = await getBillingInfo(state, "NJMCD");

    for (var i = 0; i < entries.length; i++) {
      var payload = getPayload(entries[i]);
      payload["billingData"] = billingData;
      transactions.push(generateTransactionObjAZ(payload));
    }

    const multipleEDIJson = generateMedicaidJsonForMultipleAZ(transactions);
    setNumOfSegments(multipleEDIJson.Groups[0].Transactions);
    convertToEDI(multipleEDIJson);
    await generateDAT(EDI);
    return res.send(EDI);
  } catch (error) {
    console.log(error);
    const statusCode = 400;
    const errorMessage = "Something went wrong!";

    return res
      .status(statusCode)
      .json({ sucess: false, message: errorMessage });
  }
};

exports.getEDIfromJson = async function (req, res) {
  try {
    const customerData = await getCustomerInfo("3001438");
    const companyData = await getCompanyInfo("3001438");
    const taskData = await getTaskData("3001438");
    const claimAmount = await getClaimAmount("3001438");
    const procedureCode = await getProcedureCode("3000157");

    const jsonPayload = {
      customerData,
      companyData,
      taskData,
      claimAmount,
      procedureCode,
    };

    const ediJson = generateMedicaidJson(jsonPayload);
    setNumOfSegments(ediJson.Groups[0].Transactions);
    convertToEDI(ediJson);
    await generateDAT(EDI);
    return res.send(EDI);
  } catch (error) {
    const statusCode = 400;
    const errorMessage = "Something went wrong!";

    return res
      .status(statusCode)
      .json({ sucess: false, message: errorMessage });
  }
};

getERAfromClaimMD = async function (era_id) {

  const form_data = {
    AccountKey: CLAIM_MD_API_KEY,
    eraid: era_id
  };

  const rem_resp = await axios.post( `https://svc.claim.md/services/eradata/`, new URLSearchParams(form_data).toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
    }
  );

  const data = rem_resp.data;

  return data;
}

exports.getClaimResponseFromClaimMD = async function (req, res) {
  const job = schedule.scheduleJob({ minute: 0, tz: 'America/New_York' }, async function () {
    try {

      let resp_id_data = await DBSendResponse(`SELECT * FROM claimmd_era_response_ids WHERE id = (SELECT MAX(id) FROM claimmd_era_response_ids WHERE last_responseid IS NOT NULL);`);
      const form_data = {AccountKey: CLAIM_MD_API_KEY, ResponseID: resp_id_data.length > 0 ? String(resp_id_data[0].last_responseid) : 0};
      const resp = await axios.post(`https://svc.claim.md/services/response/`, new URLSearchParams(form_data).toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
          },
        }
      );
      let response_data = resp.data;
      let last_responseid = response_data.last_responseid;
      if (last_responseid === undefined) {
        return;
      }
      let claim_responses = response_data.claim;
      for (let index = 0; index < claim_responses.length; index += 100) {

        let update_query_errors = "UPDATE Claim SET errDescription = CASE ";
        let update_query_resp_time = "UPDATE Claim SET LastResponseDate = CASE ";

        for (const claim of claim_responses.slice(index, Math.min(index + 100, claim_responses.length))) {
          let claim_id = claim.remote_claimid;
          let messages = claim.messages;
          let status = claim.status === 'A' ? 'Accepted' : 'Rejected';
          let claim_response_messages = messages.map((msg) => msg.message).join("; ");
          if (status === "Rejected") {
            update_query_errors += `WHEN claim_ID = ${claim_id} THEN '${claim_response_messages}' `
          }
          update_query_resp_time += `WHEN claim_ID = ${claim_id} THEN '${moment(claim.response_time, "YYYY-MM-DD hh:mm:ssA").format("MM/DD/YYYY")}' `
        }

        let indiced_claims = claim_responses.slice(index, Math.min(index + 100, claim_responses.length));
        let accepted_claims = indiced_claims.filter((clm) => clm.status === 'A');
        let rejected_claims = indiced_claims.filter((clm) => clm.status === 'R');

        if (indiced_claims.length !== 0) {
          update_query_resp_time += `END WHERE claim_ID IN (${indiced_claims.map((clm) => clm.remote_claimid).join(",")})`
          let resp_time_query_resp = await DBUpdate(update_query_resp_time);
          console.log(resp_time_query_resp);
        }
        
        if (accepted_claims.length !== 0) {
          let update_query_accepted = `UPDATE Claim SET Status = 'Accepted' WHERE claim_ID IN (${accepted_claims.map((clm) => clm.remote_claimid).join(",")})`;
          let accepted_query_resp = await DBUpdate(update_query_accepted);
          console.log(accepted_query_resp);
        }

        if (rejected_claims.length !== 0) {
          let update_query_rejected = `UPDATE Claim SET Status = 'Rejected' WHERE claim_ID IN (${rejected_claims.map((clm) => clm.remote_claimid).join(",")})`;
          update_query_errors += `END WHERE claim_ID IN (${rejected_claims.filter((clm) => clm.status === 'R').map((clm) => clm.remote_claimid).join(",")})`;
          let rejected_query_resp = await DBUpdate(update_query_rejected);
          console.log(rejected_query_resp);
          let error_query_resp = await DBUpdate(update_query_errors);
          console.log(error_query_resp);
        }
        
      }
      await DBUpdate(`INSERT INTO claimmd_era_response_ids (last_responseid,updated_on) VALUES ('${last_responseid}', CURRENT_TIMESTAMP);`);
    } catch (error) {
      console.log(error);
    }
  });
}

exports.getRecentERAListFromClaimMD = async function (req, res) {

  const job = schedule.scheduleJob({ hour: 8, minute: 0, tz: 'America/New_York' }, async function () {
    try {

      console.log("this ran");
      const form_data = {AccountKey: CLAIM_MD_API_KEY, NewOnly: 1};
      const resp = await axios.post( `https://svc.claim.md/services/eralist/`, new URLSearchParams(form_data).toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
          },
        }
      );
  
      let era_responses = []
  
      let status_map = {
        "1": "Processed as Primary",
        "2": "Processed as Secondary",
        "4": "Denied",
        "22": "Reversal of Previous Payment",
      }
  
      let status_mapped_claim_ids = {
        "1" : [],
        "2" : [],
        "4": [],
        "22": []
      }
  
      let new_era_data = resp.data;
      while (new_era_data.last_eraid !== undefined) {
        await DBUpdate(`INSERT INTO claimmd_era_response_ids (last_eraid,updated_on) VALUES ('${new_era_data.last_eraid}', CURRENT_TIMESTAMP);`);
        if (new_era_data.era) {
          for (const era of new_era_data.era) {
            let era_id = era.eraid;
            let era_data = await getERAfromClaimMD(era_id);
            let claims = era_data.claim;
            for (const claim of claims) {
              let claim_id = claim.charge[0].chgid;
              let status = claim.status_code;
              status_mapped_claim_ids[status].push(Number(claim_id));
            }
            era_responses.push(era_data);
          }
          let all_claim_ids = []
          for (let [key, val] of Object.entries(status_mapped_claim_ids)) {
            if (val.length != 0) {
              let updateQ = `UPDATE Claim SET Status = '${status_map[key]}' WHERE claim_ID in (${val.join(",")})`;
              all_claim_ids = [...all_claim_ids,...val];
              let updateResp = await DBUpdate(updateQ);
            }
          }
          if (all_claim_ids) {
            let updateResponseTime = `Update Claim SET LastResponseDate = '${moment().utc().toISOString()}' WHERE claim_ID IN (${all_claim_ids.join(",")})`;
            let updateResp = await DBUpdate(updateResponseTime);
          }
        }
        const form_data = {AccountKey: CLAIM_MD_API_KEY, NewOnly: 1};
        const resp = await axios.post(`https://svc.claim.md/services/eralist/`, new URLSearchParams(form_data).toString(), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json'
            }
          }
        );
        new_era_data = resp.data; 
      }
  
    } catch (error) {
      console.log(error);
    }
  });
}

async function getPayerInfo(payers) {
  let payerQuery = `select claimMd_payerId, payer_name, payer_id from payer where payer_id in (${payers.join(",")})`
  let payerData = await DBSendResponse(payerQuery);
  let payerInfo = {}
  payerData.forEach(p => {
    payerInfo[Number(p.payer_id)] = p.claimMd_payerId
  });
  return payerInfo;
}

exports.getJsonForClaimMD = async function (req, res) {
  /*
  -> claim.md NEEDS patient address information for processing claims
  -> for current implementation, payers active in multiple state don't show up in the "add a payer" dropdown
  -> when a payer is added, email recieved from claim.md doesn't include any links
  -> priorAuth check on frontend needs adjustment, different payers have different formats
  */
  // let resp = await getPayerListFromClaimMD();
  // return res.json({
  //   resp: resp,
  // })

  let payerIds = Array.from(new Set(req.body.entries.map(clm => clm.payerId)));

  let payerInfo = await getPayerInfo(payerIds);

  let njmmisClaims = req.body.entries.filter((clm) => payerInfo[String(clm.payerId)] === "NJMCD");
  let otherClaims = req.body.entries.filter((clm) => payerInfo[String(clm.payerId)] !== "NJMCD");

  let njResp = undefined;

  console.log(njmmisClaims, otherClaims);

  if (njmmisClaims.length !== 0) {
    njResp = await getEDIfromJsonData(req,njmmisClaims);
  }

  if (otherClaims.length === 0) {
    return res.json({njResp});
  }

  let file = {
    fileid: "137", // has to be some kind of file_id and unique everytime a file is uploaded
    claim: [],
  };

  try {
    let entries = otherClaims;
    const uploadedByID = req.body.emp_id;

    var transactions = [];
    let state = req.body.state ? req.body.state : 'NJ';
    const billingData = await getBillingInfo(state, "");
    const companyData = await getCompanyInfo(req.body.comp_id);
    
    entries = entries.sort((a, b) => a.claim_ID - b.claim_ID);
    let payers = Array.from(new Set(entries.map((clm) => clm.payerId)));
    const payerData = await getPayerInfo(payers);
    console.log(payerData);
    entries = entries.map((e) => {
      return  {...e, payerId: payerData[e.payerId]}
    });

    let totalClaimAmount = 0;

    console.log("begin");
    for (var i = 0; i < entries.length; i++) {
      var payload = getPayload(entries[i]);
      totalClaimAmount += parseFloat(payload.claimAmount.amount);
      payload["billingData"] = billingData;
      payload["companyData"] = companyData;
      // console.log(payload)
      transactions.push(generateClaimObjClaimMD(payload));
    }

    console.log(transactions);

    file.claim = transactions;

    const form = {
      "AccountKey" : CLAIM_MD_API_KEY,
      "File" : JSON.stringify(file),
      "Filename": "testComp1.json"
    }

    let resp = await axios.post(`https://svc.claim.md/services/upload/`, new URLSearchParams(form).toString(), {
      headers : {
        Accept: 'application/json'
      }
    }).then((axiosRes) => {
      console.log("sucessRes:", axiosRes.data);
      return res.json({
        njResp,
        resp: axiosRes.data,
        status: "receieved",
      });
    }).catch((axiosErr) => {
      console.log("errorRes:", axiosErr.data);
      return res.json({
        status: "failed",
        resp : axiosErr.data
      })
    });

    // let resp = await fetch(
    //   `https://svc.claim.md/services/upload/`,
    //   {
    //     method: 'POST',
    //     headers: {
    //       Accept: 'application/json'
    //     },
    //     body: form
    //   }
    // );


    // console.log(resp);

    

    // const multipleEDIJson = generateMedicaidJsonForMultiple(transactions);
    // setNumOfSegments(multipleEDIJson.Groups[0].Transactions);
    // convertToEDI(multipleEDIJson);

    // // console.log("here")
    // await generateDAT(EDI);
    // const upRes = await uploadIt(uploadedByID);
    // let empId = req.body.emp_id,
    //   empName = req.body.empName,
    //   empCompanyId = req.body.comp_id,
    //   companyName = req.body.companyName;
    // if (empId && empName && transactions && empCompanyId && companyName) {
    //   analytics.track({
    //     userId: String(empId),
    //     event: "Claims submitted",
    //     context: {
    //       groupId: empCompanyId,
    //     },
    //     properties: {
    //       submittedBy: empName,
    //       claims: String(transactions.length),
    //       companyId: empCompanyId,
    //       companyName: companyName,
    //       time: moment().format("MM/DD/YYYY HH:mm:ss"),
    //       amountClaimed: totalClaimAmount,
    //     },
    //   });
    //   console.log("logged to segment successfully");
    // }
    // return res.send(upRes);
  } catch (error) {
    console.log(error);
    const statusCode = 400;
    const errorMessage = "Something went wrong!";

    return res
      .status(statusCode)
      .json({ sucess: false, message: errorMessage, error: error });
  }
};



async function getPayerListFromClaimMD() {
  console.log(CLAIM_MD_API_KEY);
  const formData = {
    AccountKey: CLAIM_MD_API_KEY,
  };

  const headers = {
    'Accept': 'application/json'
  }

  const resp = await axios.post(`https://svc.claim.md/services/payerlist/`,new URLSearchParams(formData).toString(), {
    headers: headers
  })


  // const resp = await fetch(
    
  //   {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/x-www-form-urlencoded',
  //       Accept: 'application/json'
  //     },
  //     body: new URLSearchParams(formData).toString()
  //   }
  // );
  let relevantData = resp.data.payer;
  console.log(relevantData.length);
  let failedData = []
  for (let i = 0; i  < relevantData.length; i++) {
    let payer = relevantData[i];
    const data = {
      payer_name: generateSQLText(payer.payer_name,256,"New Payer"),
      claimMd_payerId: generateSQLText(payer.payerid,256,"Payer ID"),
      payer_state: payer.payer_state ? generateSQLText(payer.payer_state,256,"") : undefined,
      prof_claims_supp: generateSQLText(payer["1500_claims"],256,"no"),
      inst_claims_supp: generateSQLText(payer.ub_claims,256,"no"),
      remittance_supp: generateSQLText(payer.era,256,"no"),
      payer_type: generateSQLText(payer.payer_type,256,""),
      secondary_supp: generateSQLText(payer.secondary_support,256,"no"),
      dent_claims_supp: generateSQLText(payer.dent_claims,256,"no"),
      eligibility_supp: generateSQLText(payer.eligibility,256,"no"),
      workers_comp_supp: generateSQLText(payer.workers_comp,256,"no"),
      attachment_supp: generateSQLText(payer.attachment,256,"no"),
    };
    const insQuery = generateInsertSQL('payer', data) + 'SELECT SCOPE_IDENTITY()';
    try {
      const newPayerId = await DBinsertSendID(insQuery)
    } catch (err) {
      console.log('QUERY FAILURE | addProvider Query Failed:')
      console.log(err)
      failedData.push([payer,err]);
    }
  }
  return failedData;
}

function generateClaimObjClaimMD(payload) {
  let claimObj = {
    accept_assign: "Y", // ?
    auto_accident: "N", // ?
    balance_due: payload.claimAmount.amount, // total balance due
    bill_addr_1: payload.companyData.address, // mapped to company address
    bill_city: payload.companyData.city, // mapped to company city
    bill_name: payload.companyData.companyName, // mapped to company name
    bill_npi: payload.companyData.npi, // mapped to company npi
    bill_phone: "7322386133", // not used
    bill_state: payload.companyData.state, // mapped to company state
    bill_taxid: payload.companyData.companyTaxID, // mapped to company taxid
    bill_taxid_type: "E", // defaulted to E in our case
    bill_zip: payload.companyData.zip, // mapped to company zip9
    charge: [
      {
        charge: payload.claimAmount.amount, // mapped to amount
        charge_record_type: "UN", // defaulted to UN in our case
        diag_ref: "A", // this is basically reference to diag code, defaulted to 1  in our case
        from_date: payload.taskData.taskStartDate, // mapped to start date
        place_of_service: payload.taskData.placeOfServiceCode ? payload.taskData.placeOfServiceCode : '99', // defaulted to 99 in our case
        proc_code: payload.claimmdProcCode.procedureCode, // mapped to proc code IMPORTANT: NEED TO CHECK WITH CLAIMMD ABOUT MODIFIERS
        remote_chgid: payload.taskData.claimId, // claim_ID
        thru_date: payload.taskData.taskEndDate, // mapped to end date
        units: payload.claimAmount.units, // mapped to units in our case
        mod1: payload.claimmdProcCode.modifier1 ? payload.claimmdProcCode.modifier1 : null,
        mod2: payload.claimmdProcCode.modifier2 ? payload.claimmdProcCode.modifier2 : null,
        mod3: payload.claimmdProcCode.modifier3 ? payload.claimmdProcCode.modifier3 : null
      },
    ],
    claim_form: "1500", // probably claim form type
    employment_related: "N", // ? (we are probably defaulting it to N)
    ins_number: payload.customerData.medicaidID, // mapped to medicaid in our case
    pat_addr_1: payload.customerData.address, // not used
    pat_city: payload.customerData.city, // not used
    pat_dob: payload.customerData.dob, // mapped to paitent dob
    pat_name_f: payload.customerData.subscriberFirstName, // mapped to patient fname
    pat_name_l: payload.customerData.subscriberLastName, // mapped to patient lname
    pat_rel: payload.customerData.relationship ? payload.customerData.relationship : "18", // defaulted to self in our case
    pat_sex: payload.customerData.subscriberGender, // mapped to patient gender
    pat_state: payload.customerData.state, // not used
    pat_zip: payload.customerData.zip, // not used
    payerid: payload.payerId ? payload.payerId : payload.billingData.payer_id, // defaulted because our files always go to NJMMIS
    pcn: payload.customerData.medicaidID, // we used medicaid ID here, this is patient account number
    prior_auth: payload.customerData.priorAuthorization,
    remote_batchid: "200001", // batch id
    remote_claimid: payload.taskData.claimId, // claim id
    remote_fileid: "400001", // remote file id
    total_charge: payload.claimAmount.amount, // mapped to total charges
  };

  let allDiagCodes = payload.customerData.ICD_10.split("/");
  allDiagCodes.forEach((code, index) => {
    claimObj["diag_" + String(index + 1)] = code;
  });

  return claimObj;
}
