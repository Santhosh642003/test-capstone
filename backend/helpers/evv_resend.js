var moment = require('moment');
var db = require('../models/indexSQL.js');
const { DBinsertSendID,DBinsert,DBUpdate,DBSendResponse,DBinsertSendResponse,DBInsertAndReturn } = require('../queries/commonQueries');
var { evvAPI } = require('../utils/evvAPI.js');
var cron = require('node-cron');
const { max } = require('moment');
const { response } = require('express');
const { map } = require('../models/indexSQL.js');
const { setInternalBufferSize } = require('bson');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

exports.sendEVVData=async function(req,res){
  if(req.body.evvResendData){
    let evvResendData = [];
    try{
      evvResendData = JSON.parse(req.body.evvResendData);
    } catch(err){
      res.status(500).send({ evvResendStatus: 'Error Occured When Parsing \'evvResendData\' JSON. Please make sure your JSON is in a valid format!' });
      return;
    }
    console.log('| INFO | EVV Resend Data Recieved:');
    console.log(evvResendData);
    var invocationTimestamp=moment().format('YYYY-MM-DDTHH:mm:ss');
    let cccccc=await Promise.all(
      evvResendData.map(async (company)=>{let ccc=await sendEVV(company.com_id, null, invocationTimestamp, company.tasks);})
    );
  }
  res.send({ evvResendStatus: 'EVV Resend Complete' });
};

async function sendEVV(id, res, invocationTimestamp, tasks){
  var dataForEVVPayload = await selectEVVEntries(id, tasks);
  console.log(`\n| INFO | Number of tasks picked up for company_id=${id}: ${dataForEVVPayload.length}`);
  //emp_id is the key for the caregiversHashMap
  //task_id is the key for the taskHashMap
  let caregiverHashMap=new Map();
  let taskHashMap=new Map();
  for(let d=0;d<dataForEVVPayload.length;d++){
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
  if(result.length==0){
    console.log('| WARNING | Found Case with missing Company Tax ID and Missing Payer Id');
    updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,0,noOfCareGiverRecordsPicked,0,0,0,id,'Tax ID and/or Payer Id are missing');
    evvRecords=await generateEVVRecords(dataForEVVPayload,result, res, id, evvProcessLogId);
    await populateLogTablesForVisits(evvRecords.visit.length,id,'',[],500,'[{"message": "Tax ID and/or Payer Id are missing."}]',evvProcessLogId, evvRecords.evvIdList);
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
  summary={ caregiverRecordsSummary:{ numberOfRecordsSent:0,noOfSuccessfullySentRecords:0,noOfFailedRecords:0 },visitRecordsSummary:{ numberOfRecordsSent:0,noOfSuccessfullySentRecords:0,noOfFailedRecords:0 } };
  if(dataForEVVPayload.length>0){
    evvRecords=await generateEVVRecords(dataForEVVPayload,result, res, id, evvProcessLogId);
    console.log('| INFO | EVV Records Generated:');	
    console.log(JSON.stringify(evvRecords));
    summary={ caregiverRecordsSummary:{ numberOfRecordsSent:evvRecords.caregiver.length,noOfSuccessfullySentRecords:0,noOfFailedRecords:0 },visitRecordsSummary:{ numberOfRecordsSent:evvRecords.visit.length,noOfSuccessfullySentRecords:0,noOfFailedRecords:0 } };
        
    //sending caregiver records.. 
    var stuffToInsertInEvvProcessLogArray=[]; 
    for(var i=0;i<evvRecords.caregiver.length;i++){
      console.log('\n| INFO | here\'s a caregiver record...');
      console.log(evvRecords.caregiver[i]);
      try{
        var response = await evvAPI.caregiver(evvRecords.caregiver[i]);
      } catch(err){
        console.log(`| ERROR (Caregiver Record Submission) | ${err}`);
      }
            

      // Unable to obtain token Case
      if(response=='Unable to obtain token'){
        console.log('\n| INFO | Unable to obtain token Case');
        updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,0,noOfCareGiverRecordsPicked,0,0,0,id,'Failed to establish connection with HHAExchange'); 
        await populateLogTablesForVisits(evvRecords.visit.length,id,'',[],500,'[{"message": "Failed to establish connection with HHAExchange"}]',evvProcessLogId, evvRecords.evvIdList);
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
    console.log('\n| INFO | here are the visit records......');
    console.log(evvRecords.visit);
    try{
      var response = await evvAPI.addVisits({ 'visits':evvRecords.visit });
    } catch(err){
      console.log(`| ERROR (Visit Record Submission) | ${err}`);
    }
        
    if(response=='Unable to obtain token'){
      console.log('Unable to obtain token Case V2');
      updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,0,noOfCareGiverRecordsPicked,0,0,0,id,'Failed to establish connection with HHAExchange'); 
      await populateLogTablesForVisits(evvRecords.visit.length,id,'',[],500,'[{"message": "Failed to establish connection with HHAExchange"}]',evvProcessLogId, evvRecords.evvIdList);
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

    console.log('\n| INFO | Vists Response Data');
    console.log(response.status);
    console.log(response.data.transactionId);
    console.log(response.data);

    // Status Call
    console.log(`\n| INFO | Waiting ${60000 * 0.001} seconds for status response from HHA`);
    await sleep(60000);
    console.log('\n| INFO | Attempting to get status response from HHA');
    var evvm = await evvAPI.getTransactionStatus(response.data.transactionId);
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
    for(var x=0;x<evvm.data.evvDetails.length;x++){
      evvmsid.push(evvm.data.evvDetails[x].evvmsId);
      errors.push(evvm.data.evvDetails[x].errors);
      if(evvm.data.evvDetails[x].status=='Success'){
        summary.visitRecordsSummary.noOfSuccessfullySentRecords++;
      } else{
        summary.visitRecordsSummary.noOfFailedRecords++;
      }
    }

    let TaxId=!result[0]?'':String(result[0].com_taxid);
    let payerId=!result[0]?'':result[0].payer_name;
    processEVVTable(evvm, evvRecords, { evvProcessLogId: evvProcessLogId, id: id, TaxId, TaxId, payerId: payerId });

    // Log Caregivers
    let inludedCareGiverIds=await Promise.all(stuffToInsertInEvvProcessLogArray.map(async (cg, i)=>{
      return (await populateLogTablesForCaregivers(cg.id, cg.transactionId, cg.statusCode,cg.errors,evvProcessLogId, evvRecords.caregiver[i].firstName + ' ' + evvRecords.caregiver[i].lastName));
    }));

    // Log Visits
    let visitDataLog = await populateLogTablesForVisits(evvm.data.evvDetails.length,id,response.data.transactionId,evvm.data.evvDetails,response.status,errors,evvProcessLogId, evvRecords.evvIdList);
    await updateEvvProcessLogTable(evvProcessLogId,noOfCareGiverRecordsPicked,(summary.caregiverRecordsSummary.noOfSuccessfullySentRecords),(summary.caregiverRecordsSummary.noOfFailedRecords),summary.visitRecordsSummary.numberOfRecordsSent,summary.visitRecordsSummary.noOfSuccessfullySentRecords,summary.visitRecordsSummary.noOfFailedRecords,id,'');    

    // Log Excluded Caregivers
    let exludedCareGiverIds=await Promise.all(evvRecords.excludedCaregivers.map(async (cg)=>{
      return (await populateLogTablesForCaregivers(id, '', 500,cg.error,evvProcessLogId, cg.firstName + ' ' + cg.lastName));
    }));
    
    console.log('In',inludedCareGiverIds,'\nOut: ',exludedCareGiverIds,'\nVisit: ',visitDataLog);  
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
  let visitInserts = await Promise.all(evvmsid.map((ev,i)=> {
    var insertionTimestamp=moment().format('YYYY-MM-DD HH:mm:ss.000');
    var q2=`insert into evv_log (invocationTimestamp,transactionId,evvmsid,version,responseCode,errors,evvLogComId, evvProcessLogId, evvId, externalVisitId) values('${insertionTimestamp}','${transactionId}','${ev.evvmsId}',1,${responseCode},'${Array.isArray(errors)?removeSingleQuotes(JSON.stringify(errors[i])):errors}',${evvProcessLogComId},${currentProcessEvvProcessLogId},${!evvIdList[i]?'NULL':evvIdList[i]},${ev.externalVisitId}); SELECT SCOPE_IDENTITY();`;
    return DBInsertAndReturn(q2);
  }));
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


async function generateEVVRecords(dataForEVVPayload, result, res, company_id, evvProcessLogId){
  var TaxId=!result[0]?'':String(result[0].com_taxid);
  var payerId=!result[0]?'':result[0].payer_name;
  var taskIdList=[];
  var empIdList=[];
  var visitRecords=[];
  var caregiverRecords=[];
  let evvIdList=[];
  let excludedCaregivers=[];

  for(var i=0;i<dataForEVVPayload.length;i++){
    var procCodeQuery = `select procProcCode, procModifierCode, procCode_id, procUnitOfService from procedure_code where procTaskType = '${dataForEVVPayload[i].tas_type}'`;
    var procCodeData = [];
    try{
      procCodeData = await DBSendResponse(procCodeQuery);
      if(procCodeData.length===0){
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
                            AND CompanyID = ${company_id}
                        )
                );`;
        procCodeData = await DBSendResponse(TaskProcCodeMappingQuery);
      }
      var visitRecord={};
      var caregiverRecord={};
    }
    catch{
      console.log(`| ERROR | Could not find entry for the given task type in procedure_code. Task type: ${dataForEVVPayload[i].tas_type} Task ID: ${dataForEVVPayload[i].tas_id}`);
      continue;
    }
        
    if(!taskIdList.includes(dataForEVVPayload[i].tas_id)){
      let billingInfo = await calculateBillingInfo(dataForEVVPayload[i], procCodeData, true);
      let evvmsid_query = await DBSendResponse(`select * from evv_log where externalVisitId=${dataForEVVPayload[i].tas_id}`);
      let evvmsidFromLogs = evvmsid_query.map(log => log.evvmsid).filter(evvmsid => evvmsid !== 'null')[0];
      const contractInfo = await getContractInfo(TaxId, payerId, dataForEVVPayload[i].tas_type, company_id);
      console.log('CONTRACT INFO DEBUG');
      console.log(contractInfo);

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
      visitRecord.evvmsid= evvmsidFromLogs ? evvmsidFromLogs : null;
      visitRecord.procedureCode= procCodeData[0].procProcCode ? procCodeData[0].procProcCode : null;
      visitRecord.procedureModifierCode=procCodeData[0].procModifierCode ? procCodeData[0].procModifierCode.split(':').filter(Boolean) : [];
      visitRecord.timezone='US/Eastern';
      visitRecord.scheduleStartTime=convertVarcharTime(dataForEVVPayload[i].tas_start_time);
      visitRecord.scheduleEndTime=convertVarcharTime(dataForEVVPayload[i].tas_end_time);
      visitRecord.visitStartDateTime=convertVarcharTime(dataForEVVPayload[i].empLocdate);
      visitRecord.visitEndDateTime=convertVarcharTime(dataForEVVPayload[i].checkoutEmpDate);
      visitRecord.timesheetRequired='FALSE';
      visitRecord.timesheetApproved='FALSE';
      visitRecord.evv={};
      visitRecord.evv.clockIn={};
      visitRecord.evv.clockIn.callDateTime=convertVarcharTime(dataForEVVPayload[i].empLocdate);
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
      visitRecord.evv.clockOut.callDateTime=convertVarcharTime(dataForEVVPayload[i].checkoutEmpDate);
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
      visitRecord.billing.externalInvoiceNumber=billingInfo.evvOnly ? null : `${billingInfo.invoice_number ? billingInfo.invoice_number : dataForEVVPayload[i].tas_id}`;
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
  if(ts == null) return '';
  if (typeof ts === 'object' && ts instanceof Date) {
    ts = ts.toISOString();
  } else if (typeof ts !== 'string') {
    ts = String(ts);
  }
  return ts.substring(0, 16);
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
  for(var i=0;i<input.length;i++){
    output+=input[i];
  }
  return output;
}

async function updateStatus(){
  let status_query =
    'select * from evv_log WHERE transactionId IS NOT NULL AND (evvmsid=\'\' OR evvmsid=\' \' OR evvmsid=\'null\' OR evvmsid=NULL)';

    
}

// Selects unsent visits with checkout date after 'time' for a given company (11-12-21)
async function selectEVVEntries(company_id, tasks){
  let inString = '';
  for(let i = 0; i < tasks.length; i++){
    if(i === tasks.length - 1){
      inString += tasks[i] + '';
    } else {
      inString += tasks[i] + ',';
    }
  }

  let new_evv_query=`select t.tas_emp_id,t.tas_id,t.tas_pro_id,t.tas_start_time,t.tas_end_time,t.tas_type,p.pro_customer_id,c.medicaid_id,c.diagnose_code,e.dob,e.emp_last_name,e.emp_first_name,e.empEmail,e.emp_phone_number,e.emp_professionalLicenseNumber,e.emp_addr_line1, e.emp_addr_line2, e.emp_city, e.emp_state, e.emp_zip, l.emploc_lat, l.emploc_lon, l.empLocdate, l.checkoutEmpDate, loc.loc_addr_line1, loc.loc_addr_line2, loc.loc_city, loc.loc_state, loc.loc_zip from project as p inner join task as t on p.pro_id=t.tas_pro_id inner join customer as c on p.pro_customer_id=c.cus_id inner join employee as e on t.tas_emp_id=e.emp_id inner join empLocate as l on t.tas_id = l.taskId inner join location as loc on t.tas_loc_id=loc.loc_id where t.tas_com_id=${company_id} and (t.tas_type LIKE '%Visit') and t.tas_is_active=1 and t.tas_billable_by_default=1 and tas_id in (${inString})`;
  let dataForEVVPayload=[];
  dataForEVVPayload = await DBSendResponse(new_evv_query);

  return dataForEVVPayload;
}

async function calculateBillingInfo(EVVEntryData, procCodeData, generateInvoiceNumber){
  let DDDTierQuery = `select DDD_tier from customer where cus_id = ${EVVEntryData.pro_customer_id}`;
  DDDTier = (await DBSendResponse(DDDTierQuery))[0].DDD_tier;
  if(DDDTier===undefined || DDDTier===null){ //TODO DEFAULTS FOR PROCEDURE CODES
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
    }
  }
    
  var rate = 0;
  try{
    let rateQuery = `select rate from billingrates where procProcCode='${procCodeData[0].procProcCode + ':' + procCodeData[0].procModifierCode}'`;
    console.log(rateQuery);
    rate = (await DBSendResponse(rateQuery))[0].rate;
  }
  catch(err){
    console.log('| ERROR | COULD NOT FIND RATE');
    console.log(err);
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
      } catch(err){
        console.log('| ERROR | ' + err.message + ' Setting default max invoice number');
        invoice_number = 100000;
      }
    }
  }
    
    
  // find line_item_no
  var line_item_no = 1;
  var lineitemno_query= `select MAX(line_item_no) from invoice
    where procProcCode='${procCodeData[0].procProcCode}'
    and invoice_date >= '${moment(EVVEntryData.empLocdate).format('YYYY-MM-DD')}' and invoice_date < dateadd(day,1,'${moment(EVVEntryData.empLocdate).format('YYYY-MM-DD')}')
    and customer_id=${EVVEntryData.pro_customer_id}`;
  lineitemno_query_response = (await DBSendResponse(lineitemno_query))[0][''];
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

  const taskTypeBasedContractInfo = await DBSendResponse(`SELECT * FROM TaskProcCodeMapping WHERE dropdown_id = (SELECT ddID FROM dropdowns WHERE EntityName = 'taskType' AND EntityValue = '${taskType}' AND CompanyID = ${company_id})`); //TODO might need to use dropdown_id instead

  console.log('taskTypeBasedContractInfo DEBUG');
  console.log(`SELECT * FROM TaskProcCodeMapping WHERE dropdown_id = (SELECT ddID FROM dropdowns WHERE EntityName = 'taskType' AND EntityValue = '${taskType}' AND CompanyID = ${company_id})`);
  console.log(taskTypeBasedContractInfo);

  if(taskTypeBasedContractInfo.length > 0 && taskTypeBasedContractInfo[0]?.payerIdentifier && taskTypeBasedContractInfo[0]?.providerIdentifier){
    const payerInformation = (queryResult = await DBSendResponse(`SELECT * FROM payer WHERE payer_id=${taskTypeBasedContractInfo[0]?.payerIdentifier}`)) && queryResult?.length ? queryResult[0] : null;
    const officeInformation = (query2Result = await DBSendResponse(`SELECT * FROM provider_identifier WHERE prov_iden_id=${taskTypeBasedContractInfo[0]?.providerIdentifier}`)) && query2Result?.length ? query2Result[0] : null;
    contractInfo.officeQualifier = 'NPI';
    contractInfo.officeIdentifier = officeInformation?.prov_iden;
    contractInfo.payerIdentifier = payerInformation?.payer_name;
  }

  return contractInfo;
}

async function processEVVTable(evvm, evvRecords, evvTableInfo){
  let rawEVVData = evvRecords.raw;
  const sentIds = rawEVVData.map(entry => Number(entry.tas_id));
  const recievedIds = evvm.data.evvDetails.map(entry => Number(entry.externalVisitId));
  let evvIdList;
    
  for(let i=0;i<rawEVVData.length; i++){
    for(let j=0;j<evvm.data.evvDetails.length; j++){
      if(rawEVVData[i].tas_id == evvm.data.evvDetails[j].externalVisitId){
        if(evvm.data.evvDetails[j].evvmsId != null && evvm.data.evvDetails[j].evvmsId != 'null' && evvm.data.evvDetails[j].evvmsId != ''){
          console.log(`\n| INFO | Task with task_id ${rawEVVData[i].tas_id} recieved an evvmsid!`);
          //Get procCodeData
          var procCodeQuery = `select procProcCode, procModifierCode, procCode_id, procUnitOfService from procedure_code where procTaskType = '${rawEVVData[i].tas_type}'`;
          var procCodeData = [];
          try{
            procCodeData = await DBSendResponse(procCodeQuery);
            if(procCodeData.length===0){
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
            var visitRecord={};
            var caregiverRecord={};
          }
          catch{
            console.log(`| ERROR | Could not find entry for the given task type in procedure_code. Task type: ${rawEVVData[i].tas_type} Task ID: ${rawEVVData[i].tas_id}`);
            continue;
          }
                    
          // Get Billing Info
          let billingInfo = await calculateBillingInfo(rawEVVData[i], procCodeData, true);
                    
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
                                ${billingInfo.invoice_number},
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
                        '${rawEVVData[i].loc_state}','${rawEVVData[i].loc_zip}','${billingInfo.invoice_number}','${billingInfo.total}','${billingInfo.billing_units}','${billingInfo.rate}','${procCodeData[0].procProcCode}',${10}
                        ); SELECT SCOPE_IDENTITY();`;
    
            let evvIdResponse=await DBInsertAndReturn(evvTableQuery);
            console.log('\n| INFO | EVV Table Insert Response:');
            console.log(evvIdResponse);
          }
        }
      }
    }
  }
}