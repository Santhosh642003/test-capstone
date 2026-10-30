var moment = require('moment');
var db = require('../models/indexSQL.js');
const { DBinsertSendID,DBinsert,DBUpdate,DBSendResponse,DBinsertSendResponse,DBInsertAndReturn } = require('../queries/commonQueries');
var { evvAPI } = require('../utils/evvAPI.js');
var cron = require('node-cron');
const { max } = require('moment');
const { response, query } = require('express');
const { map } = require('../models/indexSQL.js');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
const schedule = require('node-schedule');
const { LOG_LEVEL } = require('../config');
const { logger } = require('../logger');


exports.getEVVStatusSummary= async function(req,res){
  try{
    if(req.query.tas_id){
      let data = await exports.getCurrentEVVData(req.query.tas_id);
      res.send(data);
      return;
    } else if (req.query.company_id && req.query.start && req.query.end){
      const start = moment(req.query.start).format('YYYY-MM-DDTHH:mm:ss');
      const end = moment(req.query.end).format('YYYY-MM-DDTHH:mm:ss');
    
      let evvTaskIdListQuery = `
            SELECT tas_id 
            FROM task 
            WHERE tas_start_time BETWEEN '${start}' AND '${end}' 
            AND tas_com_id = ${req.query.company_id}
            AND (tas_type LIKE '%Visit') 
            AND tas_is_active=1
            AND tas_com_id=${req.query.company_id}
            `;
      let evvTaskIdList = (await DBSendResponse(evvTaskIdListQuery)).map(item => item.tas_id);

      if(evvTaskIdList?.length < 1){
        res.status(204).json({ message: 'No EVV tasks found for the given company_id and date range' });
        return;
      }
    
      let basicTaskDataQuery = `
                SELECT 
                    task.tas_id, 
                    task.tas_title, 
                    tas_type,
                    task.tas_start_time AS scheduled_start_time, 
                    task.tas_end_time AS scheduled_end_time, 
                    task.tas_created_at,
                    project.pro_title, 
                    project.pro_id, 
                    empLocate.empLocDate AS actual_start_time, 
                    empLocate.checkoutEmpDate AS actual_end_time,
                    CONCAT(employee.emp_first_name, ' ', employee.emp_last_name) AS emp_name,
                    customer.cus_name,
                    (SELECT TOP 1 billing_externalInvoiceNumber 
                    FROM evv 
                    WHERE externalVisitId = task.tas_id 
                    ORDER BY evvId DESC) AS billing_externalInvoiceNumber
                FROM task 
                LEFT JOIN project ON task.tas_pro_id = project.pro_id
                LEFT JOIN empLocate ON task.tas_id = empLocate.taskId
                LEFT JOIN employee ON task.tas_emp_id = employee.emp_id
                LEFT JOIN customer ON project.pro_customer_id = customer.cus_id
                WHERE task.tas_id IN (${evvTaskIdList.join(',')})
            `;
      basicTaskData = await DBSendResponse(basicTaskDataQuery);
    
      let evvTaskStatuses = basicTaskData.map(async(data, index) => {
        await new Promise(resolve => setTimeout(resolve, index * 500));
        let result = await exports.getCurrentEVVData(data.tas_id);
        return { ...result, taskData: data };
      });
    
      res.json(await Promise.all(evvTaskStatuses));
      return;
    } else {
      res.status(400).json({ message: 'missing required query parameters' });
      return;
    }
  } catch(err){
    res.status(500).json({ message: 'An error occured while trying to get EVV status data' });
    console.log('An error occured while trying to get EVV status data:' + err);
  }
  res.status(500).json({ message: 'An error occured while trying to get EVV status data' });
};

exports.sendEVVData=async function(req,res){
  if(req.query.com_id){
    if(req.query.task_ids){
      const taskIds = (Array.isArray(req.query.task_ids) ? req.query.task_ids : [req.query.task_ids])
        .flatMap(taskId => String(taskId).split(','))
        .map(taskId => taskId.trim())
        .filter(Boolean);

      if(taskIds.length === 0 || taskIds.some(taskId => !/^\d+$/.test(taskId))){
        return res.status(400).send({ message: 'task_ids must be a comma-separated list of task IDs' });
      }

      await DBSendResponse(`UPDATE empLocate SET send_EVV=1 WHERE taskId IN (${taskIds.join(',')})`);
    }

    var invocationTimestamp=moment().format('YYYY-MM-DDTHH:mm:ss');
    var evvSummary = await sendEVV(req.query.com_id, res, invocationTimestamp);
  }
  res.send({ evvExecutionSummary:evvSummary });
};

exports.sendEVVDataByScheduler = async function() {
  const job = schedule.scheduleJob({ hour: [8, 20], minute: 0, tz: 'America/New_York' }, async function() {
    const randomTime = Math.floor(Math.random() * 600000);
    setTimeout(async () => {
      let recentEVVRunsQuery = `SELECT invocationTimestamp FROM evv_process_log WHERE invocationTimestamp > '${moment().add(-15, 'minutes').format('YYYY-MM-DDTHH:mm:ss')}'`;
      let recentEVVRuns = await DBSendResponse(recentEVVRunsQuery);
      
      if (recentEVVRuns.length > 0) {
        console.log('INFO | Too recent of an EVV run. Skipping...');
      } else {
        
        let invocationTimestamp = moment().format('YYYY-MM-DDTHH:mm:ss');
        
        console.log('invocationTimestamp of sendEVVDataByScheduler run is', invocationTimestamp);
        
        let getCompanyIdsQuery = 'select distinct com_id from company c inner join settings s on c.com_id = s.company_id where feature_id = 11 AND state_id=\'NJ\'';
        let companyIds = await DBSendResponse(getCompanyIdsQuery);

        await Promise.all(
          companyIds.map(async (cid) => { await sendEVV(cid.com_id, null, invocationTimestamp); })
        );
      }
    }, randomTime);
  });
};

exports.getCurrentEVVData = async function(tas_id){
  let evvmsid = null;
  let evv_logs = [];
  let evv_status = 'Unknown';

  if(tas_id){
    try{
      evvmsid = (await DBSendResponse(`select evvmsid from evv where externalVisitId=${tas_id}`))[0].evvmsid;
    } catch(err){
      evvmsid = null;
    }

    evv_logs = (await DBSendResponse(`select * from evv_log where externalVisitId=${tas_id}`));

    // 10-24-22 Get Latest Transaction Status For Requested Task ID
    let evv_transaction_statuses = [];
    for(let i = 0; i < evv_logs?.length; i++){
      let evvTransactionData = [];
            
      try{
        const statusResponse = await evvAPI.getTransactionStatus(evv_logs[i].transactionId, evv_logs[i].evvLogComId);
        evvTransactionData = (statusResponse?.data?.evvDetails || []).filter(transaction => transaction.externalVisitId == tas_id);
      } catch(err){
        console.log('| WARNING | Error occured while trying to get Transaction Status for past EVV transactions:');
        console.log(err);
      }
            
      if(evvTransactionData?.length > 0){
        evv_transaction_statuses.push(evvTransactionData[0].status);
      }
    }
    if(evv_transaction_statuses.includes('Failed')){
      evv_status = 'Failed';
    }
    if(evv_transaction_statuses.includes('Pending')){
      evv_status = 'Pending';
    }
    if(evv_transaction_statuses.includes('Success')){
      evv_status = 'Success';
    }
  }

  if(evv_status == 'Unknown'){
    console.log(`| WARNING | EVV Status for task ID ${tas_id} is unknown`);
  }

  return { evvmsid: evvmsid, evv_logs: evv_logs, evv_status: evv_status };
};

async function sendEVV(id, res, invocationTimestamp){
  var minCheckoutTime = moment().add(-18,'h').format('YYYY-MM-DDTHH:mm:ss');
  var dataForEVVPayload = await selectEVVEntries(id, minCheckoutTime);
  console.log(`\n| INFO | Number of tasks picked up for company_id=${id}: ${dataForEVVPayload?.length}`);

  //emp_id is the key for the caregiversHashMap
  //task_id is the key for the taskHashMap
  let caregiverHashMap=new Map();
  let taskHashMap=new Map();
  for(let d=0;d<dataForEVVPayload?.length;d++){
    if(!caregiverHashMap.has(dataForEVVPayload[d].tas_emp_id)){
      caregiverHashMap.set(dataForEVVPayload[d].tas_emp_id);
    }
    if(!taskHashMap.has(dataForEVVPayload[d].tas_id)){
      taskHashMap.set(dataForEVVPayload[d].tas_id);
    }
  }
  console.log(`| DEBUG | caregiverMap for EVV run at ${invocationTimestamp}: `);
  console.log(caregiverHashMap);
  console.log(`| DEBUG | taskMap for EVV run at ${invocationTimestamp}: `);
  console.log(taskHashMap);
  var noOfCareGiverRecordsPicked=caregiverHashMap.size;
  var noOfVisitRecordsPicked=taskHashMap.size;

  // Populate Initial Process Log Entry
  let evvProcessLogResponse=await populateEvvProcessLogtable(invocationTimestamp,noOfCareGiverRecordsPicked,0,0,0,0,0,id,'',noOfCareGiverRecordsPicked, noOfVisitRecordsPicked);
  var evvProcessLogId=evvProcessLogResponse.id;

  let evvRecords={};
  var summary={};

  // Check for Special Case with missing Payer ID or Tax ID
  var tax_and_payer_query=`select com_taxid, payer_name from company, payer where payerId=payer_id and (com_taxid != '' and com_taxid is not NULL and payerId is not NULL and payer_name != '' and payer_name is not NUll) and com_id=${id};`;
  var result=await DBSendResponse(tax_and_payer_query);
  if(result?.length==0){
    console.log('| WARNING | Found Case with missing Company Tax ID and Missing Payer Id');
    console.log(id);
    updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,0,noOfCareGiverRecordsPicked,0,0,0,id,'Tax ID and/or Payer Id are missing');
    evvRecords=await generateEVVRecords(dataForEVVPayload,result, res, id, evvProcessLogId);    
    await populateLogTablesForVisits(evvRecords.visit?.length,id,'',[],500,'[{"message": "Tax ID and/or Payer Id are missing."}]',evvProcessLogId, evvRecords.evvIdList);
    let goodCareGiverIds=await Promise.all(evvRecords.caregiver.map(async (cg)=>{
      return (await populateLogTablesForCaregivers(id, '', 500,'[{"message": "Tax ID and/or Payer Id are missing."}]',evvProcessLogId, cg.firstName + ' ' + cg.lastName));
    }));

    console.log('good caregiver id list', goodCareGiverIds);

    let badCareGiverIds=await Promise.all(evvRecords.excludedCaregivers.map(async (cg)=>{
      return (await populateLogTablesForCaregivers(id, '', 500,cg.error,evvProcessLogId, cg.firstName + ' ' + cg.lastName));
    }));

    console.log('bad caregiver id list', badCareGiverIds);
        
    return 'Tax ID and/or Payer Id are missing.';
  }

  summary={
    caregiverRecordsSummary: {
      numberOfRecordsSent:0,
      noOfSuccessfullySentRecords:0,
      noOfFailedRecords:0 },
    visitRecordsSummary: {
      numberOfRecordsSent:0,
      noOfSuccessfullySentRecords:0,
      noOfFailedRecords:0
    }
  };
    
  if(dataForEVVPayload?.length>0){
    evvRecords=await generateEVVRecords(dataForEVVPayload,result, res, id, evvProcessLogId);
    console.log('| INFO | EVV Records Generated:');
    console.log(JSON.stringify(evvRecords));
    summary={ caregiverRecordsSummary:{ numberOfRecordsSent:evvRecords.caregiver?.length,noOfSuccessfullySentRecords:0,noOfFailedRecords:0 },visitRecordsSummary:{ numberOfRecordsSent:evvRecords.visit?.length,noOfSuccessfullySentRecords:0,noOfFailedRecords:0 } };
        
    //sending caregiver records.. 
    var stuffToInsertInEvvProcessLogArray=[]; 
    for(var i=0;i<evvRecords.caregiver?.length;i++){
      console.log(`\n| INFO | here's a caregiver record for company id=${id ? id : '?'}: `);
      console.log(evvRecords.caregiver[i]);
      try{
        var response = await evvAPI.caregiver(evvRecords.caregiver[i], id);
      } catch(err){
        console.log(`| ERROR (Caregiver Record Submission) | ${err}`);
      }
            

      // Unable to obtain token Case
      if(response=='Unable to obtain token'){
        console.log('\n| INFO | Unable to obtain token Case');
        updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,0,noOfCareGiverRecordsPicked,0,0,0,id,'Failed to establish connection with HHAExchange'); 
        await populateLogTablesForVisits(evvRecords.visit?.length,id,'',[],500,'[{"message": "Failed to establish connection with HHAExchange"}]',evvProcessLogId, evvRecords.evvIdList);
        let goodCareGiverIds=await Promise.all(evvRecords.caregiver.map(async (cg)=>{
          return (await populateLogTablesForCaregivers(id, '', 500,'[{"message": "Failed to establish connection with HHAExchange"}]',evvProcessLogId, cg.firstName + ' ' + cg.lastName));
        }));

        console.log('\n| INFO | good caregiver id list', goodCareGiverIds);

        let badCareGiverIds=await Promise.all(evvRecords.excludedCaregivers.map(async (cg)=>{
          return (await populateLogTablesForCaregivers(id, '', 500,cg.error,evvProcessLogId, cg.firstName + ' ' + cg.lastName));
        }));

        console.log('\n| INFO | bad caregiver id list', badCareGiverIds);
                
        return 'Failed to establish connection with HHAExchange';
      }

      try{
        console.log('\n| INFO | Cargivers Response Data');
        console.log(response.status);
        console.log(response.data.transactionId);
        console.log(response.data.errors);
      } catch(err){
        console.log(`| ERROR (Caregiver Response) | ${err}`);
      }

      if(response.status=='200' || response.status=='201') {
        //noOfSuccessCareGiverRecords++
        console.log('\n| DEBUG | Caregiver Success');
        summary.caregiverRecordsSummary.noOfSuccessfullySentRecords++;
      } else {
        //noOfFailureCareGiverRecords++
        console.log('\n| DEBUG | Caregiver Failure');
        summary.caregiverRecordsSummary.noOfFailedRecords++;
      }

      var stuffToInsertInEvvProcessLog={ id:id, transactionId:response.data.transactionId, statusCode:response.status, errors:response.data.errors };
      stuffToInsertInEvvProcessLogArray.push(stuffToInsertInEvvProcessLog);
    }
      
    //sending visit records..
    console.log(`\n| INFO | here are the visit records for company id=${id ? id : '?'}: `);
    console.log(evvRecords.visit);
    try{
      var response = await evvAPI.addVisits({ 'visits':evvRecords.visit }, id);
      console.log(`addVisits response object for company id=${id ? id : '?'}: ` + response);
    } catch(err){
      console.log(`| ERROR (Visit Record Submission) | ${err}`);
    }
        
    if(response=='Unable to obtain token'){
      console.log('Unable to obtain token Case V2');
      updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,0,noOfCareGiverRecordsPicked,0,0,0,id,'Failed to establish connection with HHAExchange'); 
      await populateLogTablesForVisits(evvRecords.visit?.length,id,'',[],500,'[{"message": "Failed to establish connection with HHAExchange"}]',evvProcessLogId, evvRecords.evvIdList);
      // console.log("Checking the name " + evvRecords.caregiver[0].firstName + " " + evvRecords.caregiver[0].lastName)
      let goodCareGiverIds=await Promise.all(evvRecords.caregiver.map(async (cg)=>{
        return (await populateLogTablesForCaregivers(id, '', 500,'[{"message": "Failed to establish connection with HHAExchange"}]',evvProcessLogId, cg.firstName + ' ' + cg.lastName));
      }));

      console.log('good caregiver id list', goodCareGiverIds);

      let badCareGiverIds=await Promise.all(evvRecords.excludedCaregivers.map(async (cg)=>{
        return (await populateLogTablesForCaregivers(id, '', 500,cg.error,evvProcessLogId, cg.firstName + ' ' + cg.lastName));
      }));

      console.log('bad caregiver id list', badCareGiverIds);  
      return 'Failed to establish connection with HHAExchange';
    }

    // Status Call
    console.log(`\n| INFO | Waiting ${60000 * 0.001} seconds for status response from HHA`);
    await sleep(60000);
    console.log('\n| INFO | Attempting to get status response from HHA');
    var evvm = null;
    try{
      console.log('Getting NJ EVV Transaction Status...');
      evvm = await evvAPI.getTransactionStatus(response?.data?.transactionId, id);
    } catch(err){
      console.log('| ERROR | Error occured while trying to get Transaction Status for new run');
      console.log(err);
      logger.error('Error in getting transaction status from HHAExchange: ' + err);
    }
    console.log('\n| DEBUG | Status Response from HHA:');
    console.log(evvm);
    if(evvm){
      if(evvm.data){
        console.log('\n| DEBUG | Defined evvm');
        console.log(JSON.stringify(evvm.data));
      }
    } else {
      console.log('\n| DEBUG | Undefined evvm');
    }
    console.log('\n| DEBUG | Printed Status from HHA');
    var evvmsid=[];
    var errors=[];

    try{
      for(var x=0;x<evvm?.data?.evvDetails?.length;x++){
        evvmsid.push(evvm?.data?.evvDetails[x]?.evvmsId);
        errors.push(evvm?.data.evvDetails[x]?.errors);
        if(evvm?.data?.evvDetails[x]?.status=='Success'){
          summary.visitRecordsSummary.noOfSuccessfullySentRecords++;
        } else{
          summary.visitRecordsSummary.noOfFailedRecords++;
        }
      }
    
      let TaxId=!result[0]?'':String(result[0].com_taxid);
      let payerId=!result[0]?'':result[0].payer_name;
      await processEVVTable(evvm, evvRecords, { evvProcessLogId: evvProcessLogId, id: id, TaxId, TaxId, payerId: payerId });
    
      // Log Caregivers
      let inludedCareGiverIds=await Promise.all(stuffToInsertInEvvProcessLogArray.map(async (cg, i)=>{
        return (await populateLogTablesForCaregivers(cg.id, cg.transactionId, cg.statusCode,cg.errors,evvProcessLogId, evvRecords.caregiver[i].firstName + ' ' + evvRecords.caregiver[i].lastName));
      }));
    
      // Log Visits
      let visitDataLog = await populateLogTablesForVisits(evvm?.data?.evvDetails?.length,id,response.data.transactionId,evvm?.data?.evvDetails,response.status,errors,evvProcessLogId, evvRecords.evvIdList);
      await updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,(summary.caregiverRecordsSummary.noOfSuccessfullySentRecords),(summary.caregiverRecordsSummary.noOfFailedRecords),summary.visitRecordsSummary.numberOfRecordsSent,summary.visitRecordsSummary.noOfSuccessfullySentRecords,summary.visitRecordsSummary.noOfFailedRecords,id,'');    
    
      // Log Excluded Caregivers
      let exludedCareGiverIds=await Promise.all(evvRecords.excludedCaregivers.map(async (cg)=>{
        return (await populateLogTablesForCaregivers(id, '', 500,cg.error,evvProcessLogId, cg.firstName + ' ' + cg.lastName));
      }));
        
      console.log('In',inludedCareGiverIds,'\nOut: ',exludedCareGiverIds,'\nVisit: ',visitDataLog);  
    } catch(err){
      console.log(`| ERROR | Error occured while finishing up EVV run for company id = ${id ? id : '?'}:`);
      console.log(err);
    }
  }

  analytics.track({
    userId: String(id),
    event: 'EVV run completed',
    context: {
      groupId: String(id),
    },
    properties: {
      companyId: id,
      noOfCareGiverRecords: summary.caregiverRecordsSummary.numberOfRecordsSent,
      noOfCareGiverRecordsSentSuccessfully: summary.caregiverRecordsSummary.noOfSuccessfullySentRecords,
      noOfCareGiverRecordsFailed: summary.caregiverRecordsSummary.noOfFailedRecords,
      noOfVisitRecords: summary.visitRecordsSummary.numberOfRecordsSent,
      noOfVisitRecordsSentSuccessfully: summary.visitRecordsSummary.noOfSuccessfullySentRecords,
      noOfVisitRecordsFailed: summary.visitRecordsSummary.noOfFailedRecords,
    }
  });

  return summary;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
} 

async function populateLogTablesForCaregivers(evvProcessLogComId,transactionId,responseCode,errors,currentProcessEvvProcessLogId, emp_name){
  var insertionTimestamp=moment().format('YYYY-MM-DD HH:mm:ss.000');
  var q2=`insert into evv_log (invocationTimestamp,transactionId,evvmsid,version,responseCode,errors,evvLogComId, evvProcessLogId, emp_name) values('${insertionTimestamp}','${transactionId}','N/A (Caregiver)',1,${responseCode},'${Array.isArray(errors)?removeSingleQuotes(JSON.stringify(errors)):errors}',${evvProcessLogComId},${currentProcessEvvProcessLogId}, '${emp_name}'); SELECT SCOPE_IDENTITY();`;
  return await DBInsertAndReturn(q2);
}


async function populateLogTablesForVisits(noOfVisitsSent,evvProcessLogComId,transactionId,evvmsid,responseCode,errors, currentProcessEvvProcessLogId, evvIdList){
  console.log('populating evv log now.. evvIdList is::::::::::::::::::::',evvIdList);
  console.log(typeof(evvmsid));
  let visitInserts = [];
  try{
    visitInserts = await Promise.all(evvmsid.map((ev,i)=> {
      var insertionTimestamp=moment().format('YYYY-MM-DD HH:mm:ss.000');
      var q2=`insert into evv_log (invocationTimestamp,transactionId,evvmsid,version,responseCode,errors,evvLogComId, evvProcessLogId, evvId, externalVisitId) values('${insertionTimestamp}','${transactionId}','${ev.evvmsId}',1,${responseCode},'${Array.isArray(errors)?removeSingleQuotes(JSON.stringify(errors[i])):errors}',${evvProcessLogComId},${currentProcessEvvProcessLogId},${!evvIdList[i]?'NULL':evvIdList[i]},${ev.externalVisitId}); SELECT SCOPE_IDENTITY();`;
      return DBInsertAndReturn(q2);
    }));
  } catch (err){
    console.log('CAUGHT ERROR | populateLogTablesForVisits');
    console.log(err);
  }
    
  return visitInserts;
}

async function populateEvvProcessLogtable(invocationTimestamp,noOfCareGiverRecordsSent,noOfSuccessCareGiverRecords,noOfFailureCareGiverRecords, noOfVisitsSent, noOfSuccessVisitRecords, noOfFailureVisitRecords, evvProcessLogComId, error, noOfCareGiverRecordsPicked, noOfVisitRecordsPicked){
  var insertionTimestamp=moment().format('YYYY-MM-DD HH:mm:ss.000');
  var q=`insert into evv_process_log (invocationTimestamp,noOfCareGiverRecordsSent,noOfSuccessCareGiverRecords,noOfFailureCareGiverRecords,noOfVisitsSent,noOfSuccessVisitRecords,noOfFailureVisitRecords,evvProcessLogComId, inserted_at, error, noOfCareGiverRecordsPicked, noOfVisitRecordsPicked) values ('${invocationTimestamp}',${noOfCareGiverRecordsSent},${noOfSuccessCareGiverRecords},${noOfFailureCareGiverRecords},${noOfVisitsSent},${noOfSuccessVisitRecords},${noOfFailureVisitRecords},${evvProcessLogComId}, '${insertionTimestamp}', '${error}', ${noOfCareGiverRecordsPicked},${noOfVisitRecordsPicked}); SELECT SCOPE_IDENTITY();`;
  return (await DBInsertAndReturn(q));
}

async function updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsSent,noOfSuccessCareGiverRecords,noOfFailureCareGiverRecords, noOfVisitsSent, noOfSuccessVisitRecords, noOfFailureVisitRecords, evvProcessLogComId, error){
  let query =`update evv_process_log set noOfCareGiverRecordsSent=${noOfCareGiverRecordsSent},noOfSuccessCareGiverRecords=${noOfSuccessCareGiverRecords},noOfFailureCareGiverRecords=${noOfFailureCareGiverRecords},noOfVisitsSent=${noOfVisitsSent},noOfSuccessVisitRecords=${noOfSuccessVisitRecords}, noOfFailureVisitRecords=${noOfFailureVisitRecords},evvProcessLogComId=${evvProcessLogComId},error='${error}' where evvProcessLogId=${evvProcessLogId}`;
  return await DBUpdate(query);
}


async function generateEVVRecords(dataForEVVPayload, result, res, id, evvProcessLogId){
  var TaxId=!result[0]?'':String(result[0].com_taxid);
  var payerId=!result[0]?'':result[0].payer_name;
  var taskIdList=[];
  var empIdList=[];
  var visitRecords=[];
  var caregiverRecords=[];
  let evvIdList=[];
  let excludedCaregivers=[];

  for(var i=0;i<dataForEVVPayload?.length;i++){
    var procCodeQuery = `select procProcCode, procModifierCode, procCode_id, procUnitOfService from procedure_code where procTaskType = '${dataForEVVPayload[i].tas_type}'`;
    var procCodeData = [];
    try{
      procCodeData = await DBSendResponse(procCodeQuery);
      if(procCodeData?.length===0){
        let TaskProcCodeMappingQuery = `SELECT * 
                    FROM [dbo].[procedure_code]
                    WHERE procCode_id = (
                        SELECT procedure_code_id
                        FROM [dbo].[TaskProcCodeMapping]
                        WHERE dropdown_id = (
                            SELECT ddID 
                            FROM [dbo].[dropdowns] 
                            WHERE EntityName = 'taskType' 
                            AND EntityValue = '${dataForEVVPayload[i].tas_type}' 
                            AND CompanyID = ${id}
                        )
                );`;
        procCodeData = await DBSendResponse(TaskProcCodeMappingQuery);
      }

      // New Modifier Code Logic
      let DDDTierResponse = await DBSendResponse(
        `SELECT cu.DDD_tier
                FROM task t
                JOIN project p ON t.tas_pro_id = p.pro_id
                JOIN customer cu ON p.pro_customer_id = cu.cus_id
                WHERE t.tas_id = ${dataForEVVPayload[i].tas_id};`
      );
      if(procCodeData?.length > 0){
        let procModifierCodeQuery = `SELECT procModifierCode FROM billingRates WHERE procProcCode = '${procCodeData[0].procProcCode}' AND tier='${DDDTierResponse[0].DDD_tier}'`;
        let procModifierCodeData = await DBSendResponse(procModifierCodeQuery);
        if(procModifierCodeData?.length > 0){
          procCodeData[0].procModifierCode = procModifierCodeData[0].procModifierCode;
        } else {
          procCodeData[0].procModifierCode = '';
        }
      } else {
        console.log(`| ERROR | Could not find entry for the given task type in procedure_code. Task type: ${dataForEVVPayload[i].tas_type} Task ID: ${dataForEVVPayload[i].tas_id}`);
        continue;
      }
      // New Modifier Code Logic End

      var visitRecord={};
      var caregiverRecord={};
    }
    catch{
      console.log(`| ERROR | Could not find entry for the given task type in procedure_code. Task type: ${dataForEVVPayload[i].tas_type} Task ID: ${dataForEVVPayload[i].tas_id}`);
      continue;
    }

    if(!taskIdList.includes(dataForEVVPayload[i].tas_id)){
      let billingInfo = await calculateBillingInfo(dataForEVVPayload[i], procCodeData, true);
      const contractInfo = await getContractInfo(TaxId, payerId, dataForEVVPayload[i].tas_type, id);

      taskIdList.push(dataForEVVPayload[i].tas_id);
      visitRecord.providerTaxId=TaxId;
      //visitRecord.providerTaxId='111222333'
      visitRecord.office={};
      visitRecord.office.qualifier=contractInfo.officeQualifier;
      visitRecord.office.identifier=contractInfo.officeIdentifier;
      //visitRecord.office.identifier='111222333'
      visitRecord.member={};
      visitRecord.member.qualifier='MedicaidID';
      visitRecord.member.identifier=dataForEVVPayload[i].medicaid_id;
      visitRecord.caregiver={};
      visitRecord.caregiver.qualifier='ExternalID';
      visitRecord.caregiver.identifier=dataForEVVPayload[i].tas_emp_id;
      visitRecord.payerId=contractInfo.payerIdentifier;
      //visitRecord.payerId='WCNJ'
      visitRecord.externalVisitId=`${dataForEVVPayload[i].tas_id}`.substring(0,30);
      visitRecord.evvmsid= null;
      visitRecord.procedureCode= procCodeData[0].procProcCode ? procCodeData[0].procProcCode : null;
      visitRecord.procedureModifierCode= procCodeData[0].procModifierCode ? procCodeData[0].procModifierCode.split(':').filter(Boolean) : [];
      visitRecord.timezone='US/Eastern';
      visitRecord.scheduleStartTime=convertVarcharTime(dataForEVVPayload[i].tas_start_time);
      visitRecord.scheduleEndTime=convertVarcharTime(dataForEVVPayload[i].tas_end_time);
      visitRecord.visitStartDateTime=convertDateTime(dataForEVVPayload[i].empLocdate);
      visitRecord.visitEndDateTime=convertDateTime(dataForEVVPayload[i].checkoutEmpDate);
      visitRecord.timesheetRequired='FALSE';
      visitRecord.timesheetApproved='FALSE';
      visitRecord.evv={};
      visitRecord.evv.clockIn={};
      visitRecord.evv.clockIn.callDateTime=convertDateTime(dataForEVVPayload[i].empLocdate);
      visitRecord.evv.clockIn.callType='Mobile';
      visitRecord.evv.clockIn.callLatitude=dataForEVVPayload[i].emploc_lat;
      visitRecord.evv.clockIn.callLongitude=dataForEVVPayload[i].emploc_lon;
      visitRecord.evv.clockIn.originatingPhoneNumber='';
      visitRecord.evv.clockIn.serviceAddress={};
      visitRecord.evv.clockIn.serviceAddress.addressLine1=dataForEVVPayload[i].loc_addr_line1;
      visitRecord.evv.clockIn.serviceAddress.city=dataForEVVPayload[i].loc_city;
      visitRecord.evv.clockIn.serviceAddress.state=dataForEVVPayload[i].loc_state;
      visitRecord.evv.clockIn.serviceAddress.zipcode=dataForEVVPayload[i].loc_zip;
      visitRecord.evv.clockOut={};
      visitRecord.evv.clockOut.callDateTime=convertDateTime(dataForEVVPayload[i].checkoutEmpDate);
      visitRecord.evv.clockOut.callType='Mobile';
      visitRecord.evv.clockOut.callLatitude=dataForEVVPayload[i].emploc_lat;
      visitRecord.evv.clockOut.callLongitude=dataForEVVPayload[i].emploc_lon;
      visitRecord.evv.clockOut.originatingPhoneNumber='';
      visitRecord.evv.clockOut.serviceAddress={};
      visitRecord.evv.clockOut.serviceAddress.addressLine1=dataForEVVPayload[i].loc_addr_line1;
      visitRecord.evv.clockOut.serviceAddress.city=dataForEVVPayload[i].loc_city;
      visitRecord.evv.clockOut.serviceAddress.state=dataForEVVPayload[i].loc_state;
      visitRecord.evv.clockOut.serviceAddress.zipcode=dataForEVVPayload[i].loc_zip;
      visitRecord.evv.performedTasks=[];
      visitRecord.evv.refusedTasks=[];
      visitRecord.evv.refusedTasks=[];
      visitRecord.billing={};
      visitRecord.billing.externalInvoiceNumber=billingInfo.evvOnly ? null : `${billingInfo.invoice_number ? billingInfo.invoice_number : null}`;
      visitRecord.billing.totalBilledAmount=billingInfo.total;
      visitRecord.billing.totalUnitsBilled=billingInfo.billing_units;
      visitRecord.billing.contractRate=billingInfo.rate;
      visitRecord.billing.diagnosisCodes= (typeof(dataForEVVPayload[i].diagnose_code) === 'string') && dataForEVVPayload[i].diagnose_code !== '' && dataForEVVPayload[i].diagnose_code !== 'null' && dataForEVVPayload[i].diagnose_code !== 'undefined' ? dataForEVVPayload[i].diagnose_code.split(',').map(code => {return code.trim();}) : ['F70'];
      visitRecords.push(visitRecord);
    }
        
    let pushTocaregiverRecords=true;

    if(!empIdList.includes(dataForEVVPayload[i].tas_emp_id)){
      empIdList.push(dataForEVVPayload[i].tas_emp_id);
      caregiverRecord.providerTaxId=TaxId;
      //caregiverRecord.providerTaxId='111222333'
      caregiverRecord.qualifier='ExternalID';
      caregiverRecord.externalID=String(dataForEVVPayload[i].tas_emp_id);
      caregiverRecord.ssn='999999999';
      caregiverRecord.dateOfBirth=convertDate(dataForEVVPayload[i].dob);
      if(caregiverRecord.dateOfBirth===''){
        // if(res!=null){
        //   res.status(400)
        // }
        caregiverRecord.error='[{"message": "Date of Birth field is missing"}]';
        pushTocaregiverRecords=false;
        // return [evvIdList,'Date of Birth field is missing']
      }
      caregiverRecord.lastName=dataForEVVPayload[i].emp_last_name;
      caregiverRecord.firstName=dataForEVVPayload[i].emp_first_name;
      caregiverRecord.gender='Other';
      if(dataForEVVPayload[i].emp_phone_number==='' || dataForEVVPayload[i].emp_phone_number===null){
        // if(res!=null){
        //   res.status(400)
        // }
        pushTocaregiverRecords=false;
        //[{"message": "Tax ID and/or Payer Id are missing."}]
        caregiverRecord.error='[{"message": "Employee phone number field is missing"}]';
        // return [evvIdList,'Employee phone number field is missing']
      }
      var phone=String(dataForEVVPayload[i].emp_phone_number).replace(/[^0-9]/g, '');
      phone=phone.slice(-10);
      caregiverRecord.phoneNumber=phone;
      caregiverRecord.type='Both';
      caregiverRecord.professionalLicenseNumber=dataForEVVPayload[i].emp_professionalLicenseNumber;
      caregiverRecord.hireDate='1900-01-02';
      caregiverRecord.address={};
      caregiverRecord.address.addressLine1=dataForEVVPayload[i].emp_addr_line1;
      caregiverRecord.address.city=dataForEVVPayload[i].emp_city;
      caregiverRecord.address.state=dataForEVVPayload[i].emp_state;
      caregiverRecord.address.zipcode=dataForEVVPayload[i].emp_zip;
      pushTocaregiverRecords?caregiverRecords.push(caregiverRecord):excludedCaregivers.push(caregiverRecord);
    }
  }

  var evvRecords={};
  evvRecords.caregiver=caregiverRecords;
  evvRecords.visit=visitRecords;
  evvRecords.evvIdList=[];
  evvRecords.excludedCaregivers=excludedCaregivers;
  evvRecords.raw=dataForEVVPayload;
  return evvRecords;
}

function convertVarcharTime(ts){
  if(ts==null) return '';
  return String(ts).substring(0,16);
}

function convertDateTime(ts){
  if(ts==null) return '';
  var tsDate=new Date(String(ts));
  return convertDate(ts)+'T'+('0' + tsDate.getHours()).slice(-2)+':'+('0' + tsDate.getMinutes()).slice(-2);
}

function convertDate(inputFormat) {
  if(inputFormat==null) return '';
  function pad(s) { return (s < 10) ? '0' + s : s; }
  var d = new Date(inputFormat);
  return [d.getFullYear(),pad(d.getMonth()+1),pad(d.getDate())].join('-');
}

function removeSingleQuotes(input){
  input=input.split('\'');
  var output='';
  for(var i=0;i<input?.length;i++){
    output+=input[i];
  }
  return output;
}

async function updateStatus(){
  let status_query =
    'select * from evv_log WHERE transactionId IS NOT NULL AND (evvmsid=\'\' OR evvmsid=\' \' OR evvmsid=\'null\' OR evvmsid=NULL)';

    
}

// Selects unsent visits with checkout date after 'time' for a given company (11-12-21)
async function selectEVVEntries(company_id, time){
  let new_evv_query=
    `SELECT 
    t.tas_com_id,
    t.tas_emp_id,
    t.tas_id,
    t.tas_pro_id,
    t.tas_start_time,
    t.tas_end_time,
    t.tas_type,
    p.pro_customer_id,
    c.medicaid_id,
    c.diagnose_code,
    e.dob,
    e.emp_last_name,
    e.emp_first_name,
    e.empEmail,
    e.emp_phone_number,
    e.emp_professionalLicenseNumber,
    e.emp_addr_line1, 
    e.emp_addr_line2, 
    e.emp_city, 
    e.emp_state, 
    e.emp_zip, 
    l.emploc_lat, 
    l.emploc_lon, 
    l.empLocdate, 
    l.checkoutEmpDate, 
    l.checkoutLocId,
    CASE 
        WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_addr_line1 
        ELSE loc.loc_addr_line1 
    END AS loc_addr_line1,
    CASE 
        WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_addr_line2 
        ELSE loc.loc_addr_line2 
    END AS loc_addr_line2,
    CASE 
        WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_city 
        ELSE loc.loc_city 
    END AS loc_city,
    CASE 
        WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_state 
        ELSE loc.loc_state 
    END AS loc_state,
    CASE 
        WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_zip 
        ELSE loc.loc_zip 
    END AS loc_zip
FROM 
    project AS p 
    INNER JOIN task AS t ON p.pro_id = t.tas_pro_id 
    INNER JOIN customer AS c ON p.pro_customer_id = c.cus_id 
    INNER JOIN employee AS e ON t.tas_emp_id = e.emp_id 
    INNER JOIN empLocate AS l ON t.tas_id = l.taskId 
    INNER JOIN location AS loc ON t.tas_loc_id = loc.loc_id 
    LEFT JOIN location AS loc2 ON l.checkoutLocId = loc2.loc_id 
WHERE 
    t.tas_com_id = ${company_id} 
    AND (t.tas_type LIKE '%Visit') 
    AND l.checkoutEmpDate > '${time}' 
    AND t.tas_is_active = 1`;
  let dataForEVVPayload=[];
  dataForEVVPayload = await DBSendResponse(new_evv_query);

  // 10-24-22 Filter based on entries into evv table
  let evv_id_query = `select externalVisitId from evv where evv_comp_id=${company_id}`;
  let evvIds=[];
  evvIds = await DBSendResponse(evv_id_query);
  evvIds = evvIds.map(evvId => evvId.externalVisitId);
  let unsent = dataForEVVPayload.filter(task => !evvIds.includes(task.tas_id));

  // 10-24-22 Filter based on desired Transaction Statuses
  for(let i=unsent?.length-1; i>=0; i--){
    let status = (await exports.getCurrentEVVData(unsent[i].tas_id)).evv_status;
    if(status == 'Success' || status == 'Pending'){
      unsent.splice(i, 1);
    }
  }

  let manualSendTasksQuery = `SELECT 
        t.tas_emp_id,
        t.tas_com_id,
        t.tas_id,
        t.tas_pro_id,
        t.tas_start_time,
        t.tas_end_time,
        t.tas_type,
        p.pro_customer_id,
        c.medicaid_id,
        c.diagnose_code,
        e.dob,
        e.emp_last_name,
        e.emp_first_name,
        e.empEmail,
        e.emp_phone_number,
        e.emp_professionalLicenseNumber,
        e.emp_addr_line1, 
        e.emp_addr_line2, 
        e.emp_city, 
        e.emp_state, 
        e.emp_zip, 
        l.emploc_lat, 
        l.emploc_lon, 
        l.empLocdate, 
        l.checkoutEmpDate, 
        l.checkoutLocId,
        CASE 
            WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_addr_line1 
            ELSE loc.loc_addr_line1 
        END AS loc_addr_line1,
        CASE 
            WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_addr_line2 
            ELSE loc.loc_addr_line2 
        END AS loc_addr_line2,
        CASE 
            WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_city 
            ELSE loc.loc_city 
        END AS loc_city,
        CASE 
            WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_state 
            ELSE loc.loc_state 
        END AS loc_state,
        CASE 
            WHEN l.checkoutLocId IS NOT NULL AND l.checkoutLocId != '' THEN loc2.loc_zip 
            ELSE loc.loc_zip 
        END AS loc_zip
    FROM 
        empLocate AS l
        INNER JOIN project AS p ON l.projId = p.pro_id
        INNER JOIN company AS com ON p.pro_com_id = com.com_id
        INNER JOIN task AS t ON l.taskId = t.tas_id
        INNER JOIN customer AS c ON p.pro_customer_id = c.cus_id
        INNER JOIN employee AS e ON t.tas_emp_id = e.emp_id
        INNER JOIN location AS loc ON t.tas_loc_id = loc.loc_id
        LEFT JOIN location AS loc2 ON l.checkoutLocId = loc2.loc_id
    WHERE 
        com.com_id = ${company_id}
        AND l.send_EVV = 1
    `;

  let manuallySelectedTasks = await DBSendResponse(manualSendTasksQuery);

  let manuallySelectedTasksCleanup = await DBSendResponse(`UPDATE empLocate
    SET send_EVV = 0
    WHERE taskId IN (
        SELECT l.taskId
        FROM empLocate AS l
        INNER JOIN project AS p ON l.projId = p.pro_id
        INNER JOIN company AS com ON p.pro_com_id = com.com_id
        WHERE com.com_id = ${company_id}
          AND l.send_EVV = 1
    );`);

  //add manually selected tasks to unsent list without duplicates
  if (Array.isArray(manuallySelectedTasks) && manuallySelectedTasks?.length > 0) {
    for (let i = 0; i < manuallySelectedTasks?.length; i++) {
      const task = manuallySelectedTasks[i];
      if (task && task.tas_id && !unsent.some(unsentTask => unsentTask.tas_id === task.tas_id)) {
        unsent.push(task);
      }
    }
  } else {
    console.log('manuallySelectedTasks is not an array or is empty:', manuallySelectedTasks);
  }

  return unsent;
}

async function calculateBillingInfo(EVVEntryData, procCodeData, generateInvoiceNumber){
  let DDDTierQuery = `select DDD_tier from customer where cus_id = ${EVVEntryData.pro_customer_id}`;
  DDDTier = (await DBSendResponse(DDDTierQuery))[0].DDD_tier;
  if(DDDTier===undefined || DDDTier===null){
    if(procCodeData[0].procProcCode === 'H2021'){
      DDDTier='Base';
    } else if(procCodeData[0].procProcCode === 'T2024'){
      DDDTier='PP/PM';
    } else if(procCodeData[0].procProcCode === 'H2015' || procCodeData[0].procProcCode === 'T2021' || procCodeData[0].procProcCode === 'H2016'){
      DDDTier='A';
    } else if(procCodeData[0].procProcCode === 'H2014'){
      DDDTier='Base';
    } else if(procCodeData[0].procProcCode === 'H0004'){
      DDDTier='Assess';
    } else if(procCodeData[0].procProcCode === 'H0005'){
      DDDTier='Monitor';
    } else {
      DDDTier='Base';
    }
  }
    
  var rate = 0;
  try{
    let DDDTierResponse = await DBSendResponse(
      `SELECT cu.DDD_tier
            FROM task t
            JOIN project p ON t.tas_pro_id = p.pro_id
            JOIN customer cu ON p.pro_customer_id = cu.cus_id
            WHERE t.tas_id = ${EVVEntryData.tas_id};`
    );

    let rateQuery = `select rate from billingrates where procProcCode='${procCodeData[0].procProcCode}' and tier='${DDDTierResponse[0].DDD_tier}'`;
    console.log(rateQuery);
    rate = (await DBSendResponse(rateQuery))[0].rate;
  }
  catch(err){
    console.log('| ERROR | COULD NOT FIND RATE');
    rate = 0;
  }
    
  let billing_units = 1;
  let minutes = moment(EVVEntryData.checkoutEmpDate).diff(EVVEntryData.empLocdate, 'minutes');
  if(procCodeData[0].procUnitOfService === '1 Hour'){
    billing_units = Math.ceil(minutes / 60);
  }
  else if(procCodeData[0].procUnitOfService === '15 Minutes'){
    billing_units = Math.ceil(minutes / 15);
  }
  else{
    billing_units = 1; //default for other 3 for now
  }

  var total_billed_amount = rate * billing_units;

  let invoice_number = -1;
  if(generateInvoiceNumber){
    // find Next Invoice Number
    let invoice_number_existing_query=`select MAX(invoice_number) from invoice
        where procProcCode='${procCodeData[0].procProcCode}'
        and invoice_date >= '${moment(EVVEntryData.empLocdate).format('YYYY-MM-DD')}' and invoice_date < dateadd(day,1,'${moment(EVVEntryData.empLocdate).format('YYYY-MM-DD')}')
        and customer_id=${EVVEntryData.pro_customer_id}`;
    let invoice_number_existing_query_response = (await DBSendResponse(invoice_number_existing_query))[0][''];
    if(invoice_number_existing_query_response != null){
      invoice_number = invoice_number_existing_query_response;
    } else{
      let invoice_number_query = 'select max(invoice_number) as invoice_number from invoice';
      try{
        invoice_number = (await DBSendResponse(invoice_number_query))[0].invoice_number;
        invoice_number = invoice_number + 1;
        let invoiceinsertQuery=`insert into invoice (
                            invoice_number,
                            invoice_date,
                            comp_id,
                            customer_id,
                            procProcCode,  	
                            line_item_no
                            ) values (
                                ${invoice_number},
                                '${moment(EVVEntryData.empLocdate).format('YYYY-MM-DDT00:00:00')}',
                                ${EVVEntryData.tas_com_id},
                                ${EVVEntryData.pro_customer_id},
                                '${procCodeData[0].procProcCode}',
                                0
                            ); SELECT SCOPE_IDENTITY();`;
        let invoiceInsertResponse=await DBInsertAndReturn(invoiceinsertQuery);
      } catch(err){
        console.log('Invoice Insert Error: ' + err.message + ' Setting default max invoice number');
        invoice_number = -1;
      }
    }
  }
    
    
  // find line_item_no
  var line_item_no = 1;
  var lineitemno_query= `select MAX(line_item_no) from invoice
    where procProcCode='${procCodeData[0].procProcCode}'
    and invoice_date >= '${moment(EVVEntryData.empLocdate).format('YYYY-MM-DD')}' and invoice_date < dateadd(day,1,'${moment(EVVEntryData.empLocdate).format('YYYY-MM-DD')}')
    and customer_id=${EVVEntryData.pro_customer_id}`;
  let lineitemno_query_response = (await DBSendResponse(lineitemno_query))[0][''];
  if(line_item_no <= lineitemno_query_response){
    line_item_no = lineitemno_query_response + 1;
  }

  // Check 'EVV Only' Company Setting
  let evvOnlyQuery = `select * from settings where feature_id=71 and feature_value='true' and company_id=${EVVEntryData.tas_com_id}`;
  let evvOnlyQueryResponse = await DBSendResponse(evvOnlyQuery);

  return {
    'invoice_number': invoice_number,
    'total': total_billed_amount,
    'billing_units': billing_units,
    'rate': rate,
    'line_item_no': line_item_no,
    'evvOnly': evvOnlyQueryResponse?.length > 0 ? true : false
  };
}

async function getContractInfo(taxId, payerId, taskType, company_id){
  let contractInfo = {
    officeQualifier: 'FederalTaxID',
    officeIdentifier: taxId,
    payerIdentifier: payerId,
  };

  const taskTypeBasedContractInfo = await DBSendResponse(`SELECT * FROM TaskProcCodeMapping WHERE dropdown_id = (SELECT ddID FROM dropdowns WHERE EntityName = 'taskType' AND EntityValue = '${taskType}' AND CompanyID = ${company_id})`);

  console.log('taskTypeBasedContractInfo DEBUG');
  console.log(`SELECT * FROM TaskProcCodeMapping WHERE dropdown_id = (SELECT ddID FROM dropdowns WHERE EntityName = 'taskType' AND EntityValue = '${taskType}' AND CompanyID = ${company_id})`);
  console.log(taskTypeBasedContractInfo);

  if(taskTypeBasedContractInfo?.length > 0 && taskTypeBasedContractInfo[0]?.payerIdentifier && taskTypeBasedContractInfo[0]?.providerIdentifier){
    const payerInformation = (queryResult = await DBSendResponse(`SELECT * FROM payer WHERE payer_id=${taskTypeBasedContractInfo[0]?.payerIdentifier}`)) && queryResult?.length ? queryResult[0] : null;
    const officeInformation = (query2Result = await DBSendResponse(`SELECT * FROM provider_identifier WHERE prov_iden_id=${taskTypeBasedContractInfo[0]?.providerIdentifier}`)) && query2Result?.length ? query2Result[0] : null;
    contractInfo.officeQualifier = 'NPI';
    contractInfo.officeIdentifier = officeInformation?.prov_iden;
    contractInfo.payerIdentifier = payerInformation?.payer_name;
  }
    
  return contractInfo;
}

async function processEVVTable(evvm, evvRecords, evvTableInfo){
  if(!Array.isArray(evvm?.data?.evvDetails)){
    console.log(`| WARNING | No transaction status from HHAeXchange for company id = ${evvTableInfo?.id}; skipping evv table update`);
    return;
  }
  let rawEVVData = evvRecords.raw;
  const sentIds = rawEVVData.map(entry => Number(entry.tas_id));
  const recievedIds = evvm.data.evvDetails.map(entry => Number(entry.externalVisitId));
  let evvIdList;

  for(let i=0;i<rawEVVData?.length; i++){
    for(let j=0;j<evvm.data.evvDetails?.length; j++){
      if(rawEVVData[i].tas_id == evvm.data.evvDetails[j].externalVisitId){
        if(evvm.data.evvDetails[j].evvmsId != null && evvm.data.evvDetails[j].evvmsId != 'null' && evvm.data.evvDetails[j].evvmsId != ''){
          console.log(`\n| INFO | Task with task_id ${rawEVVData[i].tas_id} recieved an evvmsid!`);
          var procCodeQuery = `select procProcCode, procModifierCode, procCode_id, procUnitOfService from procedure_code where procTaskType = '${rawEVVData[i].tas_type}'`;
          var procCodeData = [];
          try{
            procCodeData = await DBSendResponse(procCodeQuery);
            if(procCodeData?.length===0){
              let TaskProcCodeMappingQuery = `SELECT * 
                                FROM [dbo].[procedure_code]
                                WHERE procCode_id = (
                                    SELECT procedure_code_id
                                    FROM [dbo].[TaskProcCodeMapping]
                                    WHERE dropdown_id = (
                                        SELECT ddID 
                                        FROM [dbo].[dropdowns] 
                                        WHERE EntityName = 'taskType' 
                                        AND EntityValue = '${rawEVVData[i]?.tas_type}' 
                                        AND CompanyID = ${evvTableInfo?.id}
                                    )
                            );`;
              procCodeData = await DBSendResponse(TaskProcCodeMappingQuery);
            }

            // New Modifier Code Logic
            let DDDTierResponse = await DBSendResponse(
              `SELECT cu.DDD_tier
                            FROM task t
                            JOIN project p ON t.tas_pro_id = p.pro_id
                            JOIN customer cu ON p.pro_customer_id = cu.cus_id
                            WHERE t.tas_id = ${rawEVVData[i].tas_id};`
            );
            if(procCodeData?.length > 0){
              let procModifierCodeQuery = `SELECT procModifierCode FROM billingRates WHERE procProcCode = '${procCodeData[0].procProcCode}' AND tier='${DDDTierResponse[0].DDD_tier}'`;
              let procModifierCodeData = await DBSendResponse(procModifierCodeQuery);
              if(procModifierCodeData?.length > 0){
                procCodeData[0].procModifierCode = procModifierCodeData[0].procModifierCode;
              } else {
                procCodeData[0].procModifierCode = '';
              }
            } else {
              console.log(`| ERROR | Could not find entry for the given task type in procedure_code. Task type: ${rawEVVData[i].tas_type} Task ID: ${dataForEVVPayload[i].tas_id}`);
              continue;
            }
            // New Modifier Code Logic End

            var visitRecord={};
            var caregiverRecord={};
          }
          catch{
            console.log(`| ERROR | Could not find entry for the given task type in procedure_code. Task type: ${rawEVVData[i].tas_type} Task ID: ${rawEVVData[i].tas_id}`);
            continue;
          }
                    
          let billingInfo = await calculateBillingInfo(rawEVVData[i], procCodeData, false);

          const matchingVisitRecord = evvRecords.visit.find(
            visit => String(visit.externalVisitId) === String(rawEVVData[i].tas_id)
          );

          if(!billingInfo.evvOnly){
            let invoiceinsertQuery=`insert into invoice (
                            invoice_number,
                            comp_id,
                            customer_id,
                            invoice_date,
                            procProcCode,
                            line_item_no,
                            amount,
                            added_on
                            
                            ) values (
                                ${matchingVisitRecord.billing.externalInvoiceNumber},
                                ${evvTableInfo.id},
                                ${rawEVVData[i].pro_customer_id},
                                '${moment(rawEVVData[i].empLocdate).format('YYYY-MM-DDTHH:mm:ss')}',
                                '${procCodeData[0].procProcCode}',
                                ${billingInfo.line_item_no},
                                ${billingInfo.total},
                                '${moment().format('YYYY-MM-DDTHH:mm:ss')}'
                            ); SELECT SCOPE_IDENTITY();`;
        
            let invoiceInsertResponse=await DBInsertAndReturn(invoiceinsertQuery);
            console.log('\n| INFO | Invoice Insert Response:');
            console.log(invoiceInsertResponse);
          }
                        
          var evvTableQuery=`insert into evv (
                    evvmsid,
                    evvProcessLogId,
                    record_status,
                    evv_comp_id,
                    externalVisitId,
                    providerTaxId,
                    office_qualifier,
                    office_identifier,
                    member_qualifier,
                    member_identifier,
                    caregiver_qualifier,
                    caregiver_identifier,
                    payerId,
                    procedureCode,
                    procedureModifierCode,
                    timezone,
                    scheduleStartTime,
                    scheduleEndTime,
                    visitStartDateTime,
                    visitEndDateTime,
                    timesheetRequired,
                    timesheetApproved,
                    evv_clockIn_callDateTime,
                    evv_clockIn_callType,
                    evv_clockIn_callLatitude,
                    evv_clockIn_callLongitude,
                    evv_clockIn_originatingPhoneNumber,
                    evv_clockIn_serviceAddress_addressLine1,
                    evv_clockIn_serviceAddress_city,
                    evv_clockIn_serviceAddress_state,
                    evv_clockIn_serviceAddress_zipcode,
                    evv_clockOut_callDateTime,
                    evv_clockOut_callType,
                    evv_clockOut_callLatitude,
                    evv_clockOut_callLongitude,
                    evv_clockOut_originatingPhoneNumber,
                    evv_clockOut_serviceAddress_addressLine1,
                    evv_clockOut_serviceAddress_city,
                    evv_clockOut_serviceAddress_state,
                    evv_clockOut_serviceAddress_zipcode,
                    billing_externalInvoiceNumber, 
                    billing_totalBilledAmount,
                    billing_totalUnitsBilled,
                    billing_contractRate,
                    billing_diagnosisCodes,
                    version
                    
                    ) values ('${evvm.data.evvDetails[j].evvmsId}',${evvTableInfo.evvProcessLogId},0,${evvTableInfo.id},${rawEVVData[i].tas_id},'${evvTableInfo.TaxId}',
                    'FederalTaxID','${evvTableInfo.TaxId}','MedicaidID',
                    '${rawEVVData[i].medicaid_id}','ExternalID','${rawEVVData[i].tas_emp_id}',
                    '${evvTableInfo.payerId}','${procCodeData[0].procProcCode}','${procCodeData[0].procModifierCode}','US/Eastern','${moment(convertVarcharTime(rawEVVData[i].tas_start_time)).format('YYYY-MM-DDTHH:mm:ss.000')}Z',
                    '${moment(convertVarcharTime(rawEVVData[i].tas_end_time)).format('YYYY-MM-DDTHH:mm:ss.000')}Z','${moment(convertDateTime(rawEVVData[i].empLocdate)).format('YYYY-MM-DDTHH:mm:ss.000')}Z','${moment(convertDateTime(rawEVVData[i].checkoutEmpDate)).format('YYYY-MM-DDTHH:mm:ss.000')}Z',
                    'FALSE','FALSE','${moment(convertDateTime(rawEVVData[i].empLocdate)).format('YYYY-MM-DDTHH:mm:ss.000')}Z','Mobile',
                    ${rawEVVData[i].emploc_lat},${rawEVVData[i].emploc_lon},'','${rawEVVData[i].loc_addr_line1}','${rawEVVData[i].loc_city}',
                    '${rawEVVData[i].loc_state}','${rawEVVData[i].loc_zip}',
                    '${moment(convertDateTime(rawEVVData[i].checkoutEmpDate)).format('YYYY-MM-DDTHH:mm:ss.000')}Z','Mobile',
                    ${rawEVVData[i].emploc_lat},${rawEVVData[i].emploc_lon},'','${rawEVVData[i].loc_addr_line1}','${rawEVVData[i].loc_city}',
                    '${rawEVVData[i].loc_state}','${rawEVVData[i].loc_zip}','${billingInfo.evvOnly ? null : `${matchingVisitRecord.billing.externalInvoiceNumber ? matchingVisitRecord.billing.externalInvoiceNumber : null}`}','${billingInfo.total}','${billingInfo.billing_units}','${billingInfo.rate}','${procCodeData[0].procProcCode}',${10}
                    ); SELECT SCOPE_IDENTITY();`;

          let evvIdResponse=await DBInsertAndReturn(evvTableQuery);
          console.log('\n| INFO | EVV Table Insert Response:');
          console.log(evvIdResponse);
        }
      }
    }
  }
}
