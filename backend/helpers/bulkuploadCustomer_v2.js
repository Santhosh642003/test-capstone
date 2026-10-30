const db = require('../models/indexSQL.js');
const {
  DBinsertSendID,
  DBinsertSendResponse,
  DBUpdate,
  DBSendResponse,
  generateUpdateSQL
} = require('../queries/commonQueries');
const csv = require('csvtojson');
const Constants = require('../utils/constant');
const multer = require('multer');
const axios = require('axios');
const validators = require('../helpers/validators');
const { computeDestinationPoint } = require('geolib');
const { columns } = require('../models/indexSQL.js');
const BING_API_KEY = require('../config.js');
const moment = require('moment');
const { invalid } = require('moment');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

exports.bulkImportCustomers = async (req, res) => {
  let fileData = await readFileData(req, res);
  if(fileData.errors){
    res.status(500).json({ errors: fileData.errors });
    return;
  }

  let sortedCustomers = await sortCustomers(fileData);

  let successfulCustomers = [];
  let updatedCustomers = [];
  let invalidCustomers = sortedCustomers[2];

  for(let i = 0; i < sortedCustomers[0].length; i++){
    if(await handleNewCustomer(sortedCustomers[0][i], req.query.company_id)){
      successfulCustomers.push(sortedCustomers[0][i]);
    } else {
      sortedCustomers[0][i]['errors'] = ['An unexpected error occured while handling this Customer for Bulk Import.'];
      invalidCustomers.push(sortedCustomers[0][i]);
    }
  }

  for(let i = 0; i < sortedCustomers[1].length; i++){
    if(await handleUpdatedCustomer(sortedCustomers[1][i], req.query.company_id)){
      updatedCustomers.push(sortedCustomers[1][i]);
    } else {
      sortedCustomers[1][i]['errors'] = ['An unexpected error occured while handling this Existing Customer for Bulk Import.'];
      invalidCustomers.push(sortedCustomers[1][i]);
    }
  }

  let com_id = req.query.company_id, emp_id = req.query.emp_id;
  if (com_id && emp_id) {
    analytics.track({
      userId: String(emp_id),
      event: 'Customer Import file uploaded',
      context: {
        groupId: com_id,
      },
      properties: {
        success: successfulCustomers.length,
        update: updatedCustomers.length,
        failure: invalidCustomers.length
      }
    });
    console.log('logged to segment successfully');
  }

  res.json({
    code: 200,
    message: 'Customer Import Completed',
    results: { success: successfulCustomers, update: updatedCustomers, failure: invalidCustomers },
  });

  return;
};

async function readFileData(req, res) {
  try {
    if (!req.file) {
      return { error: 'File not present or missed while uploading' };
    } else if (req.file.mimetype.substr(req.file.mimetype.length - 4, 3).toLowerCase() == 'csv'.toLowerCase()) {
      return { error: 'File is not a CSV' };
    }
    const jsonArray = await csv().fromString(req.file.buffer.toString('utf8'));
    return jsonArray;
  } catch (err) {
    console.log('| ERROR | Could not process Customer Bulk Import CSV');
    console.log(err);
    return { error: 'An Unknown error occured while trying to process the CSV File' };
  }
}

async function sortCustomers(customerRecords){
  let newCustomers = [];
  let existingCustomers = [];
  let invalidCustomers = [];

  for(let i = 0; i < customerRecords.length; i++) {
    const customer = customerRecords[i];

    /*
        if(!validators.isValidRequiredInput(customer['First Name'])){
            if ( customer['errors'] == undefined ) { customer['errors'] = [] }
            customer['errors'].push('Customer does not have a valid First Name')
        }

        if(!validators.isValidRequiredInput(customer['Last Name'])){
            if ( customer['errors'] == undefined ) { customer['errors'] = [] }
            customer['errors'].push('Customer does not have a valid Last Name')
        }
        */
    if(!validators.isValidRequiredInput(customer['DDDID'])){
      if ( customer['errors'] == undefined ) { customer['errors'] = []; }
      customer['errors'].push('Customer does not have a valid DDDID');
    }
        
    let duplicates = await DBinsertSendResponse(`select * from customer where dddid='${customer['DDDID']}'`);

    if(customer['errors'] != undefined){
      invalidCustomers.push(customer);
    } else if(duplicates.length > 0){
      existingCustomers.push(customer);
    }  else{
      newCustomers.push(customer);
    }
  }

  return [newCustomers, existingCustomers, invalidCustomers];
}

async function handleNewCustomer(customer, company_id){
  try{
    let query = `INSERT INTO customer (cus_is_company,cus_name,cus_first_name,cus_last_name,cus_address,cus_phone,cus_acquired_date,cus_status,cus_type,cus_created_at,cus_updated_at,cus_company_id,cus_is_active,cus_email,DDDID,sign_page_date,last_plan_approval_date,renewal_date,dob,diagnose_code,home_phone,mobile,email,DDD_tier,gender,medicaid_eligible,func_criteria_met,last_assess_date,medicaid_id,waiver_program,cus_age,cus_local_id)
        VALUES (
            ${['Organization'].indexOf(customer['Customer Type']) != -1 ? 1 : 0},
            '${customer['Name']}',
            '${customer['First Name']}',
            '${customer['Last Name']}',
            '${'' + customer['Address Line 1'] + ',' + customer['Address Line 2'] + ',' + customer['City'] + ',' + customer['State'] + ',' + customer['Zip']}',
            '${validators.isValidRequiredInput(customer['Phone']) ? customer['Phone'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Acquired Date']) ? customer['Acquired Date'] : moment().format('MM/DD/YYYY')}',
            '${['Active','Prospect','Transferred Out','Dormant'].indexOf(customer['Status']) != -1 ? customer['Status'] : 'Prospect'}',
            '${['Individual', 'Organization'].indexOf(customer['Customer Type']) != -1 ? customer['Customer Type'] : 'Individual'}',
            '${moment().utc().format('YYYY-MM-DDTHH:mm:ss.000777')}',
            '${moment().utc().format('YYYY-MM-DDTHH:mm:ss.000777')}',
            ${validators.isValidRequiredInput(company_id) ? company_id : '###null###'},
            '${customer['Active'] == 'Y' ? 1 : customer['Active'] == 'N' ? 0 : 1}',
            '${customer['Email']}',
            '${validators.isValidRequiredInput(customer['DDDID']) ? customer['DDDID'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Sign Page Date']) ? customer['Sign Page Date'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Last Plan Approval Date']) ? customer['Last Plan Approval Date'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Renewal Date']) ? customer['Renewal Date'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['DOB']) ? customer['DOB'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Diagnose Code']) ? customer['Diagnose Code'] : '###null###'}',
            '${'###null###'}',
            '${'###null###'}',
            '${'###null###'}',
            '${validators.isValidRequiredInput(customer['DDD Tier']) ? customer['DDD Tier'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Gender']) ? customer['Gender'] : '###null###'}',
            '${customer['Medicaid Eligible'] == 'Y' ? 1 : customer['Medicaid Eligible'] == 'N' ? 0 : '###null###'}',
            '${customer['Functional Criteria Met'] == 'Y' ? 1 : customer['Functional Criteria Met'] == 'N' ? 0 : '###null###'}',
            '${validators.isValidRequiredInput(customer['Last Assessment Date']) ? customer['Last Assessment Date'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Medicaid ID']) ? customer['Medicaid ID'] : '###null###'}',
            '${validators.isValidRequiredInput(customer['Waiver Program']) ? customer['Waiver Program'] : '###null###'}',
            '${'###null###'}',
            '${validators.isValidRequiredInput(customer['Local Customer ID']) ? customer['Local Customer ID'] : '###null###'}'
        ); SELECT SCOPE_IDENTITY();`;
    query = query.replaceAll('\'###null###\'', 'null');

    await DBinsertSendResponse(query);

    return true;
  } catch (err) {
    console.log('| ERROR | Error occured while handling a Customer for Bulk Import: ' + err);
    return false;
  }
    
}

async function handleUpdatedCustomer(customer, company_id){
  try{
    // generateUpdateSQL does not escape quotes (callers are expected to) — names like O'Brien
    const esc = (v) => (v === null || v === undefined) ? v : String(v).replace(/'/g, "''");
    let data = {
      cus_name: esc(customer['Name']),
      cus_first_name: esc(customer['First Name']), 
      cus_last_name: esc(customer['Last Name']), 
      cus_email: esc(customer['Email']),
      cus_local_id: validators.isValidRequiredInput(customer['Local Customer ID']) ? esc(customer['Local Customer ID']) : 'NULL',
      cus_phone: validators.isValidRequiredInput(customer['Phone']) ? esc(customer['Phone']) : 'NULL',
      cus_acquired_date: validators.isValidRequiredInput(customer['Acquired Date']) ? esc(customer['Acquired Date']) : moment().format('MM/DD/YYYY'),
    };
    const query = generateUpdateSQL('customer',data,`dddid='${customer['DDDID']}' and cus_company_id = ${company_id}`);
    await DBSendResponse(query);
    return true;
  } catch (err) {
    console.log(err);
    console.log('| ERROR | Error occured while handling an Existing Customer for Bulk Import');
    return false;
  }
}